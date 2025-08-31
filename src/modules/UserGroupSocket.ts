import WebSocket from 'ws';
import Bottleneck from 'bottleneck';
import { logger } from '../logger';
import { UserWebSocketGroup, WebSocketStatus } from '../types/WebSocketSubscriptions';
import {
    OrderEvent,
    TradeEvent,
    isOrderEvent,
    isTradeEvent,
    PolymarketUserWSEvent,
    UserWebSocketHandlers,
} from '../types/PolymarketWebSocket';
import _ from 'lodash';
import ms from 'ms';
import { randomInt } from 'crypto';

const CLOB_USER_WSS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/user';

export class UserGroupSocket {
    private pingInterval!: NodeJS.Timeout;

    constructor(
        private group: UserWebSocketGroup,
        private limiter: Bottleneck,
        private handlers: UserWebSocketHandlers,
    ) {}

    /**
     * Establish the websocket connection using the provided Bottleneck limiter.
     */
    public async connect(): Promise<void> {
        // Don't clean up "subscribe to all" groups even if they have no specific markets
        if (this.group.marketIds.size === 0 && !this.group.subscribeToAll) {
            this.group.status = WebSocketStatus.CLEANUP;
            return;
        }

        try {
            logger.info({
                message: 'Connecting to CLOB User WebSocket',
                groupId: this.group.groupId,
                marketIdsLength: this.group.marketIds.size,
            });
            this.group.wsClient = await this.limiter.schedule({ priority: 0 }, async () => { 
                const ws = new WebSocket(CLOB_USER_WSS_URL);
                /*
                    This handler will be replaced by the handlers in setupEventHandlers
                */
                ws.on('error', (err) => {
                    logger.warn({
                        message: 'Error connecting to CLOB User WebSocket',
                        error: err,
                        groupId: this.group.groupId,
                        marketIdsLength: this.group.marketIds.size,
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

        /*
            Define handlers within this scope to capture 'this' context
        */
        const handleOpen = async () => {
            // Don't clean up "subscribe to all" groups even if they have no specific markets
            if (group.marketIds.size === 0 && !group.subscribeToAll) {
                group.status = WebSocketStatus.CLEANUP;
                return;
            }

            group.status = WebSocketStatus.ALIVE;

            const subscriptionMessage = {
                markets: Array.from(group.marketIds),
                type: 'USER',
                auth: {
                    apiKey: group.auth.apiKey,
                    secret: group.auth.secret,
                    passphrase: group.auth.passphrase
                }
            };

            try {
                group.wsClient!.send(JSON.stringify(subscriptionMessage));
            } catch (err) {
                logger.warn({
                    message: 'Failed to send subscription message on WebSocket open',
                    error: err,
                    groupId: group.groupId,
                    marketIdsLength: group.marketIds.size,
                });
                group.status = WebSocketStatus.DEAD;
                return;
            }
            await handlers.onWSOpen?.(group.groupId, Array.from(group.marketIds));

            this.pingInterval = setInterval(() => {
                // Don't clean up "subscribe to all" groups even if they have no specific markets
                if (group.marketIds.size === 0 && !group.subscribeToAll) {
                    clearInterval(this.pingInterval);
                    group.status = WebSocketStatus.CLEANUP;
                    return;
                }

                if (!group.wsClient) {
                    clearInterval(this.pingInterval);
                    group.status = WebSocketStatus.DEAD;
                    return;
                }
                group.wsClient.ping();
            }, randomInt(ms('15s'), ms('25s')));
        };

        const handleMessage = async (data: Buffer) => {
            let events: PolymarketUserWSEvent[] = [];
            try {
                const parsedData: any = JSON.parse(data.toString());
                events = Array.isArray(parsedData) ? parsedData : [parsedData];
            } catch (err) {
                await handlers.onError?.(new Error(`Not JSON: ${data.toString()}`));
                return;
            }

            // Filter events to ensure they have valid structure
            events = events.filter((event: any): event is PolymarketUserWSEvent => 
                event && typeof event === 'object' && event.event_type
            );

            const orderEvents: OrderEvent[] = [];
            const tradeEvents: TradeEvent[] = [];

            for (const event of events) {
                if (isOrderEvent(event)) {
                    orderEvents.push(event);
                } else if (isTradeEvent(event)) {
                    tradeEvents.push(event);
                }
            }

            // Call handlers with batched events
            if (orderEvents.length > 0) {
                await handlers.onOrder?.(orderEvents);
            }

            if (tradeEvents.length > 0) {
                await handlers.onTrade?.(tradeEvents);
            }
        };

        const handlePong = () => {
            // WebSocket is alive, no action needed
        };

        const handleError = async (err: Error) => {
            await handlers.onError?.(new Error(`WebSocket error for group ${group.groupId}: ${err.message}`));
        };

        const handleClose = async (code: number, reason?: Buffer) => {
            group.status = WebSocketStatus.DEAD;
            clearInterval(this.pingInterval);
            await handlers.onWSClose?.(group.groupId, code, reason?.toString() || '');
        };

        if (group.wsClient) {
            // Remove any existing handlers
            group.wsClient.removeAllListeners();

            // Add the handlers
            group.wsClient.on('open', handleOpen);
            group.wsClient.on('message', handleMessage);
            group.wsClient.on('pong', handlePong);
            group.wsClient.on('error', handleError);
            group.wsClient.on('close', handleClose);
        }

        // Don't clean up "subscribe to all" groups even if they have no specific markets
        if (group.marketIds.size === 0 && !group.subscribeToAll) {
            group.status = WebSocketStatus.CLEANUP;
            return;
        }

        if (!group.wsClient) {
            group.status = WebSocketStatus.DEAD;
            return;
        }
    }
}