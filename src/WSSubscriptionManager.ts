import ms from 'ms';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { randomInt } from 'crypto';
import {
    WebSocketHandlers,
    PriceChangeEvent,
    BookEvent,
    LastTradePriceEvent,
    TickSizeChangeEvent,
    PolymarketWSEvent,
    PolymarketPriceUpdateEvent,
    isPriceChangeEvent,
    isBookEvent,
    isLastTradePriceEvent,
    isTickSizeChangeEvent,
    MarketSubscriptionMessage,
    SubscribeMessage,
    UnsubscribeMessage,
} from './types/PolymarketWebSocket';
import { SubscriptionManagerOptions, WebSocketConnectionStatus } from './types/WebSocketSubscriptions';

import { OrderBookCache, BookEntry } from './modules/OrderBookCache';

import { logger } from './logger';
import _ from 'lodash';

// Note: We intentionally use a static reconnection interval rather than exponential backoff.
// Perhaps change this to exponential backoff in the future.
const DEFAULT_RECONNECT_INTERVAL_MS = ms('5s');
const DEFAULT_PENDING_FLUSH_INTERVAL_MS = ms('100ms');

const CLOB_WSS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

/**
 * WebSocket Subscription Manager for Polymarket CLOB WebSocket.
 * 
 * Each instance manages a single WebSocket connection and tracks:
 * - Subscribed assets: Successfully subscribed to the WebSocket
 * - Pending assets: Waiting to be subscribed (batched and flushed periodically)
 * 
 * Instances are fully independent - no shared state between managers.
 */
class WSSubscriptionManager {
    private readonly managerId: string;
    private handlers: WebSocketHandlers;
    private bookCache: OrderBookCache;
    
    // WebSocket connection
    private wsClient: WebSocket | null = null;
    private status: WebSocketConnectionStatus = WebSocketConnectionStatus.DISCONNECTED;
    private connecting: boolean = false;
    
    // Asset tracking
    private subscribedAssetIds: Set<string> = new Set();
    private pendingSubscribeAssetIds: Set<string> = new Set();
    private pendingUnsubscribeAssetIds: Set<string> = new Set();
    
    // Timers
    private reconnectIntervalMs: number;
    private pendingFlushIntervalMs: number;
    private reconnectInterval?: NodeJS.Timeout;
    private pendingFlushInterval?: NodeJS.Timeout;
    private pingInterval?: NodeJS.Timeout;
    private connectionTimeout?: NodeJS.Timeout;

    constructor(userHandlers: WebSocketHandlers, options?: SubscriptionManagerOptions) {
        this.managerId = uuidv4();
        this.bookCache = new OrderBookCache();

        this.reconnectIntervalMs = options?.reconnectAndCleanupIntervalMs || DEFAULT_RECONNECT_INTERVAL_MS;
        this.pendingFlushIntervalMs = options?.pendingFlushIntervalMs || DEFAULT_PENDING_FLUSH_INTERVAL_MS;

        this.handlers = {
            onBook: async (events: BookEvent[]) => {
                await this.actOnSubscribedEvents(events, userHandlers.onBook);
            },
            onLastTradePrice: async (events: LastTradePriceEvent[]) => {
                await this.actOnSubscribedEvents(events, userHandlers.onLastTradePrice);
            },
            onTickSizeChange: async (events: TickSizeChangeEvent[]) => {
                await this.actOnSubscribedEvents(events, userHandlers.onTickSizeChange);
            },
            onPriceChange: async (events: PriceChangeEvent[]) => {
                await this.actOnSubscribedEvents(events, userHandlers.onPriceChange);
            },
            onPolymarketPriceUpdate: async (events: PolymarketPriceUpdateEvent[]) => {
                await this.actOnSubscribedEvents(events, userHandlers.onPolymarketPriceUpdate);
            },
            onWSClose: userHandlers.onWSClose,
            onWSOpen: userHandlers.onWSOpen,
            onError: userHandlers.onError
        };

        // Periodic reconnection check
        this.scheduleReconnectionCheck();

        // Periodic pending flush
        this.pendingFlushInterval = setInterval(() => {
            this.flushPendingSubscriptions();
        }, this.pendingFlushIntervalMs);
    }

    /**
     * Clears all WebSocket subscriptions and state.
     * 
     * This will:
     * 1. Stop all timers
     * 2. Close the WebSocket connection
     * 3. Clear all asset tracking
     * 4. Clear the order book cache
     */
    public async clearState() {
        // Stop all timers (reconnectInterval is now a timeout, not interval)
        if (this.reconnectInterval) {
            clearTimeout(this.reconnectInterval);
            this.reconnectInterval = undefined;
        }
        if (this.pendingFlushInterval) {
            clearInterval(this.pendingFlushInterval);
            this.pendingFlushInterval = undefined;
        }
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = undefined;
        }
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = undefined;
        }

        // Close WebSocket
        if (this.wsClient) {
            this.wsClient.removeAllListeners();
            this.wsClient.close();
            this.wsClient = null;
        }

        // Clear all asset tracking
        this.subscribedAssetIds.clear();
        this.pendingSubscribeAssetIds.clear();
        this.pendingUnsubscribeAssetIds.clear();
        
        // Reset status
        this.status = WebSocketConnectionStatus.DISCONNECTED;
        this.connecting = false;

        // Clear the order book cache
        this.bookCache.clear();
    }

    /** 
     * Filters events to only include those for subscribed assets.
     * Wraps user handler calls in try-catch to prevent user errors from breaking internal logic.
     * Does not call the handler if all events are filtered out.
     */
    private async actOnSubscribedEvents<T extends PolymarketWSEvent | PolymarketPriceUpdateEvent>(
        events: T[], 
        action?: (events: T[]) => Promise<void>
    ) {
        events = events.filter((event: T) => {
            if (isPriceChangeEvent(event)) {
                return event.price_changes.some(pc => this.subscribedAssetIds.has(pc.asset_id));
            }
            if ('asset_id' in event) {
                return this.subscribedAssetIds.has(event.asset_id);
            }
            return false;
        });

        // Skip if no events passed the filter
        if (events.length === 0) {
            return;
        }

        // Wrap user handler calls in try-catch
        try {
            await action?.(events);
        } catch (handlerErr) {
            logger.warn({
                message: 'Error in user event handler',
                error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
                managerId: this.managerId,
                eventCount: events.length,
            });
        }
    }

    /**  
     * Adds new subscriptions.
     * 
     * Assets are added to a pending queue and will be subscribed when:
     * - The WebSocket connects (initial subscription)
     * - The pending flush timer fires (for new assets on an existing connection)
     * 
     * @param assetIdsToAdd - The asset IDs to add subscriptions for.
     */
    public async addSubscriptions(assetIdsToAdd: string[]) {
        try {
            for (const assetId of assetIdsToAdd) {
                // Remove from pending unsubscribe if it's there (cancel the unsubscription)
                // This must happen BEFORE the subscribed check, so that adding an asset
                // that was pending unsubscribe correctly cancels the unsubscription.
                this.pendingUnsubscribeAssetIds.delete(assetId);
                
                // Skip if already subscribed (pending subscribe is safe to re-add due to Set behavior)
                if (this.subscribedAssetIds.has(assetId)) continue;
                
                // Add to pending subscribe (no-op if already pending due to Set)
                this.pendingSubscribeAssetIds.add(assetId);
            }

            // Restart intervals if they were cleared (e.g. after clearState)
            this.ensureIntervalsRunning();

            // Ensure we have a connection
            if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
                await this.connect();
            }
        } catch (error) {
            const msg = `Error adding subscriptions: ${error instanceof Error ? error.message : String(error)}`;
            await this.safeCallErrorHandler(new Error(msg));
        }
    }

    /**
     * Ensures the periodic intervals are running.
     * Called after clearState() when new subscriptions are added.
     */
    private ensureIntervalsRunning() {
        if (!this.reconnectInterval) {
            this.scheduleReconnectionCheck();
        }

        if (!this.pendingFlushInterval) {
            this.pendingFlushInterval = setInterval(() => {
                this.flushPendingSubscriptions();
            }, this.pendingFlushIntervalMs);
        }
    }

    /**
     * Schedules the next reconnection check.
     * Uses a fixed interval (default 5 seconds) between checks.
     */
    private scheduleReconnectionCheck() {
        if (this.reconnectInterval) {
            clearTimeout(this.reconnectInterval);
        }
        
        this.reconnectInterval = setTimeout(async () => {
            await this.checkReconnection();
            // Schedule next check (only if not cleared)
            if (this.reconnectInterval) {
                this.scheduleReconnectionCheck();
            }
        }, this.reconnectIntervalMs);
    }

    /**
     * Safely calls the error handler, catching any exceptions thrown by it.
     * Prevents user handler exceptions from breaking internal logic.
     */
    private async safeCallErrorHandler(error: Error): Promise<void> {
        try {
            await this.handlers.onError?.(error);
        } catch (handlerErr) {
            logger.warn({
                message: 'Error in onError handler',
                originalError: error.message,
                handlerError: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
                managerId: this.managerId,
            });
        }
    }

    /**  
     * Removes subscriptions.
     * 
     * @param assetIdsToRemove - The asset IDs to remove subscriptions for.
     */
    public async removeSubscriptions(assetIdsToRemove: string[]) {
        try {
            for (const assetId of assetIdsToRemove) {
                // Remove from pending subscribe if it's there
                if (this.pendingSubscribeAssetIds.delete(assetId)) {
                    continue; // Was only pending, no need to send unsubscribe
                }
                
                // If subscribed, add to pending unsubscribe
                if (this.subscribedAssetIds.has(assetId)) {
                    this.pendingUnsubscribeAssetIds.add(assetId);
                }
                
                // Note: We don't clear the book cache here because the unsubscription
                // hasn't been sent yet. The cache entry will be cleared when the
                // unsubscription is flushed (after the asset is removed from subscribedAssetIds).
            }
        } catch (error) {
            const errMsg = `Error removing subscriptions: ${error instanceof Error ? error.message : String(error)}`;
            await this.safeCallErrorHandler(new Error(errMsg));
        }
    }

    /**
     * Get all currently monitored asset IDs.
     * This includes both successfully subscribed assets and pending subscriptions.
     * 
     * @returns Array of asset IDs being monitored.
     */
    public getAssetIds(): string[] {
        const allAssets = new Set<string>(this.subscribedAssetIds);
        for (const assetId of this.pendingSubscribeAssetIds) {
            allAssets.add(assetId);
        }
        // Exclude pending unsubscribes
        for (const assetId of this.pendingUnsubscribeAssetIds) {
            allAssets.delete(assetId);
        }
        return Array.from(allAssets);
    }

    /**
     * Returns statistics about the current state of the subscription manager.
     */
    public getStatistics(): {
        openWebSockets: number;
        assetIds: number;
        pendingSubscribeCount: number;
        pendingUnsubscribeCount: number;
        /** @deprecated Use pendingSubscribeCount + pendingUnsubscribeCount instead */
        pendingAssetIds: number;
    } {
        const isOpen = this.wsClient?.readyState === WebSocket.OPEN;
        
        return {
            openWebSockets: isOpen ? 1 : 0,
            assetIds: this.getAssetIds().length,
            pendingSubscribeCount: this.pendingSubscribeAssetIds.size,
            pendingUnsubscribeCount: this.pendingUnsubscribeAssetIds.size,
            pendingAssetIds: this.pendingSubscribeAssetIds.size + this.pendingUnsubscribeAssetIds.size,
        };
    }

    /**
     * Flush pending subscriptions and unsubscriptions to the WebSocket.
     * 
     * SUBSCRIPTION PROTOCOL NOTE:
     * The Polymarket WebSocket protocol does NOT send any confirmation or acknowledgment
     * messages for subscribe/unsubscribe operations. The server silently processes these
     * requests. We optimistically assume success after sending. If the server rejects
     * a request (e.g., invalid asset ID), events for those assets simply won't arrive -
     * there is no error response to handle.
     * 
     * This means:
     * - We cannot definitively know if a subscription succeeded
     * - We cannot definitively know if an unsubscription succeeded
     * - The only indication of failure is the absence of expected events
     */
    private flushPendingSubscriptions() {
        if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
            return;
        }

        // Process unsubscriptions first
        if (this.pendingUnsubscribeAssetIds.size > 0) {
            const toUnsubscribe = Array.from(this.pendingUnsubscribeAssetIds);
            
            const message: UnsubscribeMessage = {
                operation: 'unsubscribe',
                assets_ids: toUnsubscribe,
            };

            // IMPORTANT: The Polymarket WebSocket protocol does NOT send any confirmation
            // or acknowledgment message for subscribe/unsubscribe operations. The server
            // silently accepts the request. We optimistically assume success after sending.
            // If the server rejects the request, events for those assets simply won't arrive
            // (there is no error response to handle).
            try {
                this.wsClient.send(JSON.stringify(message));
                // Remove from subscribed, clear pending, and clear book cache for unsubscribed assets
                for (const assetId of toUnsubscribe) {
                    this.subscribedAssetIds.delete(assetId);
                    this.bookCache.clear(assetId);
                }
                this.pendingUnsubscribeAssetIds.clear();
                
                logger.info({
                    message: `Unsubscribed from ${toUnsubscribe.length} asset(s)`,
                    managerId: this.managerId,
                });
            } catch (error) {
                logger.warn({
                    message: 'Failed to send unsubscribe message',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Process subscriptions
        if (this.pendingSubscribeAssetIds.size > 0) {
            const toSubscribe = Array.from(this.pendingSubscribeAssetIds);
            
            const message: SubscribeMessage = {
                operation: 'subscribe',
                assets_ids: toSubscribe,
            };

            // IMPORTANT: The Polymarket WebSocket protocol does NOT send any confirmation
            // or acknowledgment message for subscribe/unsubscribe operations. The server
            // silently accepts the request. We optimistically assume success after sending.
            // If the server rejects the request, events for those assets simply won't arrive
            // (there is no error response to handle).
            try {
                this.wsClient.send(JSON.stringify(message));
                // Move to subscribed and clear pending
                for (const assetId of toSubscribe) {
                    this.subscribedAssetIds.add(assetId);
                }
                this.pendingSubscribeAssetIds.clear();
                
                logger.info({
                    message: `Subscribed to ${toSubscribe.length} asset(s)`,
                    managerId: this.managerId,
                });
            } catch (error) {
                logger.warn({
                    message: 'Failed to send subscribe message',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Close WebSocket if no assets remain and no pending unsubscriptions
        // (pendingUnsubscribeAssetIds is already cleared at this point)
        if (this.subscribedAssetIds.size === 0 && 
            this.pendingSubscribeAssetIds.size === 0 && 
            this.pendingUnsubscribeAssetIds.size === 0) {
            this.closeWebSocket();
        }
    }

    /**
     * Closes the WebSocket connection and cleans up related resources.
     */
    private closeWebSocket() {
        if (this.wsClient) {
            logger.info({
                message: 'Closing WebSocket - no assets to monitor',
                managerId: this.managerId,
            });
            
            this.wsClient.removeAllListeners();
            this.wsClient.close();
            this.wsClient = null;
        }
        
        this.status = WebSocketConnectionStatus.DISCONNECTED;
        this.connecting = false;
        
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = undefined;
        }
    }

    /**
     * Check if we need to reconnect.
     * Note: Assets are moved to pending in handleClose/handleError handlers,
     * so this method only needs to check if reconnection is needed.
     */
    private async checkReconnection() {
        // If we have pending assets but no connection, reconnect
        const hasPendingAssets = this.pendingSubscribeAssetIds.size > 0;
        const isDisconnected = !this.wsClient || this.wsClient.readyState !== WebSocket.OPEN;
        
        if (hasPendingAssets && isDisconnected && !this.connecting) {
            logger.info({
                message: 'Reconnection check - attempting to reconnect',
                managerId: this.managerId,
                pendingCount: this.pendingSubscribeAssetIds.size,
            });
            
            // Clear stale book cache data - will be repopulated after reconnection
            this.bookCache.clear();
            
            await this.connect();
        }
    }

    /**
     * Establish the WebSocket connection.
     */
    private async connect(): Promise<void> {
        if (this.connecting) {
            return;
        }
        if (this.wsClient?.readyState === WebSocket.OPEN) {
            return;
        }

        // No assets to subscribe to
        if (this.pendingSubscribeAssetIds.size === 0 && this.subscribedAssetIds.size === 0) {
            return;
        }

        this.connecting = true;
        this.status = WebSocketConnectionStatus.CONNECTING;

        try {
            logger.info({
                message: 'Connecting to CLOB WebSocket',
                managerId: this.managerId,
                pendingAssetCount: this.pendingSubscribeAssetIds.size,
            });

            this.wsClient = new WebSocket(CLOB_WSS_URL);
            
            // Set up event handlers immediately (handlers are set up before any events can fire)
            this.setupEventHandlers();

            // Connection timeout
            this.connectionTimeout = setTimeout(async () => {
                if (this.connecting && this.wsClient && this.wsClient.readyState !== WebSocket.OPEN) {
                    logger.warn({
                        message: 'WebSocket connection timeout',
                        managerId: this.managerId,
                    });
                    this.status = WebSocketConnectionStatus.DISCONNECTED;
                    this.connecting = false;
                    if (this.wsClient) {
                        this.wsClient.removeAllListeners();
                        this.wsClient.close();
                        this.wsClient = null;
                    }
                    // Notify error handler about the timeout
                    await this.safeCallErrorHandler(new Error('WebSocket connection timeout after 30s'));
                }
            }, ms('30s'));

        } catch (err) {
            this.status = WebSocketConnectionStatus.DISCONNECTED;
            this.connecting = false;
            throw err;
        }
    }

    /**
     * Sets up event handlers for the WebSocket connection.
     */
    private setupEventHandlers() {
        const ws = this.wsClient;
        if (!ws) return;

        const handleOpen = async () => {
            this.status = WebSocketConnectionStatus.CONNECTED;
            this.connecting = false;

            if (this.connectionTimeout) {
                clearTimeout(this.connectionTimeout);
                this.connectionTimeout = undefined;
            }

            // Send an empty MarketSubscriptionMessage as the initial handshake.
            // The Polymarket WebSocket protocol requires a 'market' type message as the first message.
            // We send it with an empty assets_ids array, and then use 'subscribe' operation messages
            // for all actual subscriptions (via flushPendingSubscriptions) to keep the subscription
            // logic consistent in one place.
            try {
                const initMessage: MarketSubscriptionMessage = {
                    assets_ids: [],
                    type: 'market',
                };
                ws.send(JSON.stringify(initMessage));
            } catch (error) {
                logger.warn({
                    message: 'Failed to send initial market message',
                    error: error instanceof Error ? error.message : String(error),
                    managerId: this.managerId,
                });
                // Close and let reconnection logic handle retry
                // Wrap in try-catch as close() can throw in edge cases
                try {
                    ws.close();
                } catch (closeErr) {
                    logger.debug({
                        message: 'Error closing WebSocket after init message failure (safe to ignore)',
                        error: closeErr instanceof Error ? closeErr.message : String(closeErr),
                        managerId: this.managerId,
                    });
                }
                return;
            }

            
            const pendingAssets = Array.from(this.pendingSubscribeAssetIds);
            
            // Safely call open handler
            try {
                await this.handlers.onWSOpen?.(this.managerId, pendingAssets);
            } catch (handlerErr) {
                logger.warn({
                    message: 'Error in onWSOpen handler',
                    error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
                    managerId: this.managerId,
                });
            }

            // Immediately flush pending subscriptions now that we're connected
            this.flushPendingSubscriptions();

            // Start ping interval with jitter per-ping
            const basePingIntervalMs = ms('20s');
            this.pingInterval = setInterval(() => {
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                    if (this.pingInterval) {
                        clearInterval(this.pingInterval);
                        this.pingInterval = undefined;
                    }
                    return;
                }
                // Add jitter by randomly delaying the ping within a ±5s window
                const jitterMs = randomInt(0, ms('5s'));
                setTimeout(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.ping();
                        } catch (pingErr) {
                            // Ping can fail if the socket is closing or in a bad state.
                            // This is not critical - the socket will be cleaned up on close/error events.
                            logger.debug({
                                message: 'Ping failed (safe to ignore)',
                                error: pingErr instanceof Error ? pingErr.message : String(pingErr),
                            });
                        }
                    }
                }, jitterMs);
            }, basePingIntervalMs);
        };

        const handleMessage = async (data: Buffer) => {
            try {
                const messageStr = data.toString();
                const normalizedMessageStr = messageStr.trim().toUpperCase();

                if (normalizedMessageStr === 'PONG') {
                    return;
                }

                let events: PolymarketWSEvent[] = [];
                try {
                    const parsedData: any = JSON.parse(messageStr);
                    events = Array.isArray(parsedData) ? parsedData : [parsedData];
                } catch (err) {
                    await this.safeCallErrorHandler(new Error(`Not JSON: ${messageStr}`));
                    return;
                }

                events = _.filter(events, (event: PolymarketWSEvent) => {
                    if (!event) return false;
                    if (isPriceChangeEvent(event)) {
                        return event.price_changes && event.price_changes.length > 0;
                    }
                    return _.size(event.asset_id) > 0;
                });

                const bookEvents: BookEvent[] = [];
                const lastTradeEvents: LastTradePriceEvent[] = [];
                const tickEvents: TickSizeChangeEvent[] = [];
                const priceChangeEvents: PriceChangeEvent[] = [];

                for (const event of events) {
                    if (isPriceChangeEvent(event)) {
                        const relevantChanges = event.price_changes.filter(
                            pc => this.subscribedAssetIds.has(pc.asset_id)
                        );
                        if (relevantChanges.length === 0) continue;
                        priceChangeEvents.push({
                            ...event,
                            price_changes: relevantChanges
                        });
                    } else {
                        // Safely check asset_id existence
                        const assetId = 'asset_id' in event ? event.asset_id : undefined;
                        if (!assetId || !this.subscribedAssetIds.has(assetId)) continue;

                        if (isBookEvent(event)) {
                            bookEvents.push(event);
                        } else if (isLastTradePriceEvent(event)) {
                            lastTradeEvents.push(event);
                        } else if (isTickSizeChangeEvent(event)) {
                            tickEvents.push(event);
                        } else {
                            await this.safeCallErrorHandler(new Error(`Unknown event: ${JSON.stringify(event)}`));
                        }
                    }
                }

                // Wrap each handler call in try-catch to prevent one failure
                // from breaking the entire event loop
                try {
                    await this.handleBookEvents(bookEvents);
                } catch (err) {
                    logger.warn({
                        message: 'Error in handleBookEvents',
                        error: err instanceof Error ? err.message : String(err),
                        managerId: this.managerId,
                    });
                }
                
                try {
                    await this.handleTickEvents(tickEvents);
                } catch (err) {
                    logger.warn({
                        message: 'Error in handleTickEvents',
                        error: err instanceof Error ? err.message : String(err),
                        managerId: this.managerId,
                    });
                }
                
                try {
                    await this.handlePriceChangeEvents(priceChangeEvents);
                } catch (err) {
                    logger.warn({
                        message: 'Error in handlePriceChangeEvents',
                        error: err instanceof Error ? err.message : String(err),
                        managerId: this.managerId,
                    });
                }
                
                try {
                    await this.handleLastTradeEvents(lastTradeEvents);
                } catch (err) {
                    logger.warn({
                        message: 'Error in handleLastTradeEvents',
                        error: err instanceof Error ? err.message : String(err),
                        managerId: this.managerId,
                    });
                }
            } catch (err) {
                await this.safeCallErrorHandler(new Error(`Error handling message: ${err}`));
            }
        };

        const handlePong = () => {
            // Pong received - connection is alive
        };

        const handleError = async (err: Error) => {
            this.status = WebSocketConnectionStatus.DISCONNECTED;
            this.connecting = false;
            
            // Clean up WebSocket reference - close the socket before nullifying
            // Wrap in try-catch because close() can throw if socket is in a bad state
            if (this.wsClient) {
                this.wsClient.removeAllListeners();
                try {
                    this.wsClient.close();
                } catch (closeErr) {
                    logger.debug({
                        message: 'Error closing WebSocket in error handler (safe to ignore)',
                        error: closeErr instanceof Error ? closeErr.message : String(closeErr),
                        managerId: this.managerId,
                    });
                }
                this.wsClient = null;
            }
            
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = undefined;
            }
            if (this.connectionTimeout) {
                clearTimeout(this.connectionTimeout);
                this.connectionTimeout = undefined;
            }
            
            // Move subscribed assets back to pending for re-subscription,
            // but skip assets that user wanted to unsubscribe (preserve user intent)
            for (const assetId of this.subscribedAssetIds) {
                if (!this.pendingUnsubscribeAssetIds.has(assetId)) {
                    this.pendingSubscribeAssetIds.add(assetId);
                }
            }
            this.subscribedAssetIds.clear();
            
            // Clear pending unsubscribes - they were either:
            // 1. Successfully excluded from re-subscription (above), or
            // 2. Were never subscribed anyway (user's intent is preserved)
            this.pendingUnsubscribeAssetIds.clear();
            
            // Clear the book cache - data is stale and will be repopulated on reconnection
            this.bookCache.clear();
            
            // Safely call error handler
            try {
                await this.handlers.onError?.(new Error(`WebSocket error: ${err.message}`));
            } catch (handlerErr) {
                logger.warn({
                    message: 'Error in onError handler',
                    error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
                    managerId: this.managerId,
                });
            }
        };

        const handleClose = async (code: number, reason?: Buffer) => {
            this.status = WebSocketConnectionStatus.DISCONNECTED;
            this.connecting = false;
            
            // Clean up WebSocket reference
            if (this.wsClient) {
                this.wsClient.removeAllListeners();
                this.wsClient = null;
            }
            
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = undefined;
            }
            if (this.connectionTimeout) {
                clearTimeout(this.connectionTimeout);
                this.connectionTimeout = undefined;
            }
            
            // Move subscribed assets back to pending for re-subscription,
            // but skip assets that user wanted to unsubscribe (preserve user intent)
            for (const assetId of this.subscribedAssetIds) {
                if (!this.pendingUnsubscribeAssetIds.has(assetId)) {
                    this.pendingSubscribeAssetIds.add(assetId);
                }
            }
            this.subscribedAssetIds.clear();
            
            // Clear pending unsubscribes - they were either:
            // 1. Successfully excluded from re-subscription (above), or
            // 2. Were never subscribed anyway (user's intent is preserved)
            this.pendingUnsubscribeAssetIds.clear();
            
            // Clear the book cache - data is stale and will be repopulated on reconnection
            this.bookCache.clear();
            
            // Safely call close handler
            try {
                await this.handlers.onWSClose?.(this.managerId, code, reason?.toString() || '');
            } catch (handlerErr) {
                logger.warn({
                    message: 'Error in onWSClose handler',
                    error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
                    managerId: this.managerId,
                });
            }
        };

        ws.removeAllListeners();
        ws.on('open', handleOpen);
        ws.on('message', handleMessage);
        ws.on('pong', handlePong);
        ws.on('error', handleError);
        ws.on('close', handleClose);
    }

    /**
     * Handles book events by updating the cache and notifying listeners.
     */
    private async handleBookEvents(bookEvents: BookEvent[]): Promise<void> {
        if (bookEvents.length) {
            for (const event of bookEvents) {
                this.bookCache.replaceBook(event);
            }
            await this.handlers.onBook?.(bookEvents);
        }
    }

    /**
     * Handles tick size change events by notifying listeners.
     */
    private async handleTickEvents(tickEvents: TickSizeChangeEvent[]): Promise<void> {
        if (tickEvents.length) {
            await this.handlers.onTickSizeChange?.(tickEvents);
        }
    }

    /**
     * Handles price change events.
     */
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

                const assetIds: string[] = event.price_changes.map(pc => pc.asset_id);

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

    /**
     * Handles last trade price events.
     */
    private async handleLastTradeEvents(lastTradeEvents: LastTradePriceEvent[]): Promise<void> {
        if (lastTradeEvents.length) {
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

export { WSSubscriptionManager, WebSocketHandlers };
