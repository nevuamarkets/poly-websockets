import WebSocket from 'ws';
import Bottleneck from 'bottleneck';
import { logger } from '../logger';
import { WebSocketGroup, WebSocketStatus } from '../types/WebSocketSubscriptions';
import { BookEntry, OrderBookCache } from './OrderBookCache';
import {
    BookEvent,
    isBookEvent,
    isLastTradePriceEvent,
    isPriceChangeEvent,
    isTickSizeChangeEvent,
    LastTradePriceEvent,
    PriceChangeEvent,
    TickSizeChangeEvent,
    PolymarketWSEvent,
    WebSocketHandlers,
    PolymarketPriceUpdateEvent,
} from '../types/PolymarketWebSocket';
import _ from 'lodash';
import ms from 'ms';
import { randomInt } from 'crypto';

const CLOB_WSS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export class GroupSocket {
    private pingInterval?: NodeJS.Timeout;

    constructor(
        private group: WebSocketGroup,
        private limiter: Bottleneck,
        private bookCache: OrderBookCache,
        private handlers: WebSocketHandlers,
    ) {}

    /**
     * Establish the websocket connection using the provided Bottleneck limiter.
     * 
     */
    public async connect(): Promise<void> {
        if (this.group.assetIds.size === 0) {
            this.group.status = WebSocketStatus.CLEANUP;
            return;
        }

        try {
            logger.info({
                message: 'Connecting to CLOB WebSocket',
                groupId: this.group.groupId,
                assetIdsLength: this.group.assetIds.size,
            });
            this.group.wsClient = await this.limiter.schedule({ priority: 0 }, async () => { 
                const ws = new WebSocket(CLOB_WSS_URL);
                /*
                    This handler will be replaced by the handlers in setupEventHandlers
                */
                ws.on('error', (err) => {
                    logger.warn({
                        message: 'Error connecting to CLOB WebSocket',
                        error: err,
                        groupId: this.group.groupId,
                        assetIdsLength: this.group.assetIds.size,
                    });
                });
                return ws;
            });
        } catch (err) {
            this.group.status = WebSocketStatus.DEAD;
            throw err; // caller responsible for error handler
        }

        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        const group = this.group;
        const handlers = this.handlers;
        
        // Capture the current WebSocket instance to avoid race conditions
        const currentWebSocket = group.wsClient;
        if (!currentWebSocket) {
            return;
        }

        /*
            Define handlers within this scope to capture 'this' context
        */
        const handleOpen = async () => {
            if (group.assetIds.size === 0) {
                group.status = WebSocketStatus.CLEANUP;
                return;
            }

            // Verify this handler is for the current WebSocket instance
            if (currentWebSocket !== group.wsClient) {
                logger.warn({
                    message: 'handleOpen called for stale WebSocket instance',
                    groupId: group.groupId,
                });
                return;
            }

            // Additional safety check for readyState
            if (currentWebSocket.readyState !== WebSocket.OPEN) {
                logger.warn({
                    message: 'handleOpen called but WebSocket is not in OPEN state',
                    groupId: group.groupId,
                    readyState: currentWebSocket.readyState,
                });
                return;
            }

            group.status = WebSocketStatus.ALIVE;

            currentWebSocket.send(JSON.stringify({ assets_ids: Array.from(group.assetIds), type: 'market' }));
            await handlers.onWSOpen?.(group.groupId, Array.from(group.assetIds));

            this.pingInterval = setInterval(() => {
                if (group.assetIds.size === 0) {
                    clearInterval(this.pingInterval);
                    group.status = WebSocketStatus.CLEANUP;
                    return;
                }

                // Verify we're still using the same WebSocket
                if (currentWebSocket !== group.wsClient) {
                    clearInterval(this.pingInterval);
                    return;
                }

                if (!currentWebSocket || currentWebSocket.readyState !== WebSocket.OPEN) {
                    clearInterval(this.pingInterval);
                    group.status = WebSocketStatus.DEAD;
                    return;
                }
                currentWebSocket.ping();
            }, randomInt(ms('15s'), ms('25s')));
        };

        const handleMessage = async (data: Buffer) => {
            const messageStr = data.toString();

            // Handle PONG messages that might be sent to message handler during handler reattachment
            if (messageStr === 'PONG') {
                return;
            }

            let events: PolymarketWSEvent[] = [];
            try {
                const parsedData: any = JSON.parse(messageStr);
                events = Array.isArray(parsedData) ? parsedData : [parsedData];
            } catch (err) {
                await handlers.onError?.(new Error(`Not JSON: ${messageStr}`));
                return;
            }

            // Filter events to ensure validity
            events = _.filter(events, (event: PolymarketWSEvent) => {
                // For price_change events, check that price_changes array exists
                if (isPriceChangeEvent(event)) {
                    return event.price_changes && event.price_changes.length > 0;
                }
                // For all other events, check asset_id
                return _.size(event.asset_id) > 0;
            });

            const bookEvents: BookEvent[] = [];
            const lastTradeEvents: LastTradePriceEvent[] = [];
            const tickEvents: TickSizeChangeEvent[] = [];
            const priceChangeEvents: PriceChangeEvent[] = [];

            for (const event of events) {
                /* 
                    Skip events for asset ids that are not in the group to ensure that
                    we don't get stale events for assets that were removed.
                */
                if (isPriceChangeEvent(event)) {
                    // Check if any of the price_changes are for assets in this group
                    const relevantChanges = event.price_changes.filter(price_change_item => group.assetIds.has(price_change_item.asset_id));
                    if (relevantChanges.length === 0) {
                        continue;
                    }
                    // Only include relevant changes
                    priceChangeEvents.push({
                        ...event,
                        price_changes: relevantChanges
                    });
                } else {
                    // For all other events, check asset_id at root
                    if (!group.assetIds.has(event.asset_id!)) {
                        continue;
                    }

                    if (isBookEvent(event)) {
                        bookEvents.push(event);
                    } else if (isLastTradePriceEvent(event)) {
                        lastTradeEvents.push(event);
                    } else if (isTickSizeChangeEvent(event)) {
                        tickEvents.push(event);
                    } else {
                        await handlers.onError?.(new Error(`Unknown event: ${JSON.stringify(event)}`));
                    }
                }
            }

            await this.handleBookEvents(bookEvents);
            await this.handleTickEvents(tickEvents);
            await this.handlePriceChangeEvents(priceChangeEvents);
            await this.handleLastTradeEvents(lastTradeEvents);
        };

        const handlePong = () => {
            group.groupId;
        };

        const handleError = (err: Error) => {
            group.status = WebSocketStatus.DEAD;
            clearInterval(this.pingInterval);
            handlers.onError?.(new Error(`WebSocket error for group ${group.groupId}: ${err.message}`));
        };

        const handleClose = async (code: number, reason?: Buffer) => {
            group.status = WebSocketStatus.DEAD;
            clearInterval(this.pingInterval);
            await handlers.onWSClose?.(group.groupId, code, reason?.toString() || '');
        };

        // Remove any existing handlers
        currentWebSocket.removeAllListeners();

        // Add the handlers
        currentWebSocket.on('open', handleOpen);
        currentWebSocket.on('message', handleMessage);
        currentWebSocket.on('pong', handlePong);
        currentWebSocket.on('error', handleError);
        currentWebSocket.on('close', handleClose);

        if (group.assetIds.size === 0) {
            group.status = WebSocketStatus.CLEANUP;
            return;
        }
    }

    private async handleBookEvents(bookEvents: BookEvent[]): Promise<void> {
        if (bookEvents.length) {
            for (const event of bookEvents) {
                this.bookCache.replaceBook(event);
            }
            await this.handlers.onBook?.(bookEvents);
        }
    }

    private async handleTickEvents(tickEvents: TickSizeChangeEvent[]): Promise<void> {
        if (tickEvents.length) {
            await this.handlers.onTickSizeChange?.(tickEvents);
        }
    }

    private async handlePriceChangeEvents(priceChangeEvents: PriceChangeEvent[]): Promise<void> {
        if (priceChangeEvents.length) {
            await this.handlers.onPriceChange?.(priceChangeEvents);

            for (const event of priceChangeEvents) {
                try {
                    this.bookCache.upsertPriceChange(event);
                } catch (err: any) {
                    logger.debug({ 
                        message: `Skipping derived future price calculation price_change: book not found for asset`, 
                        event: event,
                        error: err?.message
                    });
                    continue;
                }

                // Handle price updates per asset
                const assetIds: string[] = event.price_changes.map(price_change_item => price_change_item.asset_id);

                for (const assetId of assetIds) {
                    let spreadOver10Cents: boolean;
                    try {
                        spreadOver10Cents = this.bookCache.spreadOver(assetId, 0.1);
                    } catch (err: any) {
                        logger.debug({ 
                            message: 'Skipping derived future price calculation for price_change: error calculating spread', 
                            asset_id: assetId, 
                            event: event,
                            error: err?.message
                        });
                        continue;
                    }

                    if (!spreadOver10Cents) {
                        let newPrice: string;
                        try {
                            newPrice = this.bookCache.midpoint(assetId);
                        } catch (err: any) {
                            logger.debug({ 
                                message: 'Skipping derived future price calculation for price_change: error calculating midpoint', 
                                asset_id: assetId, 
                                event: event,
                                error: err?.message
                            });
                            continue;
                        }

                        const bookEntry: BookEntry | null = this.bookCache.getBookEntry(assetId);
                        if (!bookEntry) {
                            logger.debug({ 
                                message: 'Skipping derived future price calculation price_change: book not found for asset', 
                                asset_id: assetId, 
                                event: event,
                            });
                            continue;
                        }

                        if (newPrice !== bookEntry.price) {
                            bookEntry.price = newPrice;
                            const priceUpdateEvent: PolymarketPriceUpdateEvent = {
                                asset_id: assetId,
                                event_type: 'price_update',
                                triggeringEvent: event,
                                timestamp: event.timestamp,
                                book: { bids: bookEntry.bids, asks: bookEntry.asks },
                                price: newPrice,
                                midpoint: bookEntry.midpoint || '',
                                spread: bookEntry.spread || '',
                            };
                            await this.handlers.onPolymarketPriceUpdate?.([priceUpdateEvent]);
                        }
                    }
                }
            }
        }
    }

    private async handleLastTradeEvents(lastTradeEvents: LastTradePriceEvent[]): Promise<void> {
        if (lastTradeEvents.length) {
            /*
                Note: There is no need to edit the book here. According to the docs, a separate
                book event is sent when a trade affects the book.

                See: https://docs.polymarket.com/developers/CLOB/websocket/market-channel#book-message
            */
            await this.handlers.onLastTradePrice?.(lastTradeEvents);

            for (const event of lastTradeEvents) {
                let spreadOver10Cents: boolean;
                try {
                    spreadOver10Cents = this.bookCache.spreadOver(event.asset_id, 0.1);
                } catch (err: any) {
                    logger.debug({ 
                        message: 'Skipping derived future price calculation for last_trade_price: error calculating spread', 
                        asset_id: event.asset_id, 
                        event: event,
                        error: err?.message
                    });
                    
                    continue;
                }
                if (spreadOver10Cents) {
                    // Ensure no trailing zeros
                    const newPrice = parseFloat(event.price).toString();

                    const bookEntry: BookEntry | null = this.bookCache.getBookEntry(event.asset_id);
                    if (!bookEntry) {
                        logger.debug({ 
                            message: 'Skipping derived future price calculation last_trade_price: book not found for asset', 
                            asset_id: event.asset_id, 
                            event: event,
                        });
                        continue;
                    }
                    if (newPrice !== bookEntry.price) {
                        bookEntry.price = newPrice;
                        const priceUpdateEvent: PolymarketPriceUpdateEvent = {
                            asset_id: event.asset_id,
                            event_type: 'price_update',
                            triggeringEvent: event,
                            timestamp: event.timestamp,
                            book: { bids: bookEntry.bids, asks: bookEntry.asks },
                            price: newPrice,
                            midpoint: bookEntry.midpoint || '',
                            spread: bookEntry.spread || '',
                        };
                        await this.handlers.onPolymarketPriceUpdate?.([priceUpdateEvent]);
                    }
                }
            }
        }
    }
} 