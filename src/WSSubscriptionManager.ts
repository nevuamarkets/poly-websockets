import ms from 'ms';
import _ from 'lodash';
import Bottleneck from 'bottleneck';
import {
    WebSocketHandlers,
    PriceChangeEvent,
    BookEvent,
    LastTradePriceEvent,
    TickSizeChangeEvent,
    PolymarketWSEvent,
    PolymarketPriceUpdateEvent
} from './types/PolymarketWebSocket';
import { SubscriptionManagerOptions } from './types/WebSocketSubscriptions';

import { GroupRegistry } from './modules/GroupRegistry';
import { OrderBookCache } from './modules/OrderBookCache';
import { GroupSocket } from './modules/GroupSocket';

import { logger } from './logger';


// Keeping a burst limit under 10/s to avoid rate limiting
// See https://docs.polymarket.com/quickstart/introduction/rate-limits#api-rate-limits
const BURST_LIMIT_PER_SECOND = 5;

const DEFAULT_RECONNECT_AND_CLEANUP_INTERVAL_MS = ms('10s');
const DEFAULT_MAX_MARKETS_PER_WS = 100;

class WSSubscriptionManager {
    private handlers: WebSocketHandlers;
    private burstLimiter: Bottleneck;
    private groupRegistry: GroupRegistry;
    private bookCache: OrderBookCache;
    private reconnectAndCleanupIntervalMs: number;
    private maxMarketsPerWS: number;

    constructor(userHandlers: WebSocketHandlers, options?: SubscriptionManagerOptions) {
        this.groupRegistry = new GroupRegistry();
        this.bookCache = new OrderBookCache();
        this.burstLimiter = options?.burstLimiter || new Bottleneck({
            reservoir: BURST_LIMIT_PER_SECOND,
            reservoirRefreshAmount: BURST_LIMIT_PER_SECOND,
            reservoirRefreshInterval: ms('1s'),
            maxConcurrent: BURST_LIMIT_PER_SECOND
        });

        this.reconnectAndCleanupIntervalMs = options?.reconnectAndCleanupIntervalMs || DEFAULT_RECONNECT_AND_CLEANUP_INTERVAL_MS;
        this.maxMarketsPerWS = options?.maxMarketsPerWS || DEFAULT_MAX_MARKETS_PER_WS;

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

        this.burstLimiter.on('error', (err: Error) => {
            this.handlers.onError?.(err);
        });

        // Check for dead groups every 10s and reconnect them if needed
        setInterval(() => {
            this.reconnectAndCleanupGroups();
        }, this.reconnectAndCleanupIntervalMs);
    }

    /*
        Clears all WebSocket subscriptions and state.

        This will:

        1. Remove all subscriptions and groups
        2. Close all WebSocket connections
        3. Clear the order book cache
    */
    public async clearState() {
        const previousGroups = await this.groupRegistry.clearAllGroups();

        // Close sockets outside the lock
        for (const group of previousGroups) {
            this.groupRegistry.disconnectGroup(group);
        }

        // Also clear the order book cache
        this.bookCache.clear();
    }

    /* 
        This function is called when:
        - a websocket event is received from the Polymarket WS
        - a price update event detected, either by after a 'last_trade_price' event or a 'price_change' event
        depending on the current bid-ask spread (see https://docs.polymarket.com/polymarket-learn/trading/how-are-prices-calculated)

        The user handlers will be called **ONLY** for assets that are actively subscribed to by any groups.
    */
    private async actOnSubscribedEvents<T extends PolymarketWSEvent | PolymarketPriceUpdateEvent>(events: T[], action?: (events: T[]) => Promise<void>) {

        // Filter out events that are not subscribed to by any groups
        events = _.filter(events, (event: T) => {
            const groupIndices = this.groupRegistry.getGroupIndicesForAsset(event.asset_id);

            if (groupIndices.length > 1) {
                logger.warn({
                    message: 'Found multiple groups for asset',
                    asset_id: event.asset_id,
                    group_indices: groupIndices
                });
            }
            return groupIndices.length > 0;
        });

        await action?.(events);
    }

    /*  
        Edits wsGroups: Adds new subscriptions.

        - Filters out assets that are already subscribed
        - Finds a group with capacity or creates a new one
        - Creates a new WebSocket client and adds it to the group
    */
    public async addSubscriptions(assetIdsToAdd: string[]) {
        try {
            const groupIdsToConnect = await this.groupRegistry.addAssets(assetIdsToAdd, this.maxMarketsPerWS);
            for (const groupId of groupIdsToConnect) {
                await this.createWebSocketClient(groupId, this.handlers);
            }
        } catch (error) {
            const msg = `Error adding subscriptions: ${error instanceof Error ? error.message : String(error)}`;
            await this.handlers.onError?.(new Error(msg));
        }
    }

    /*  
        Edits wsGroups: Removes subscriptions.
        The group will use the updated subscriptions when it reconnects.
        We do that because we don't want to miss events by reconnecting.
    */
    public async removeSubscriptions(assetIdsToRemove: string[]) {
        try {
            await this.groupRegistry.removeAssets(assetIdsToRemove, this.bookCache);
        } catch (error) {
            const errMsg = `Error removing subscriptions: ${error instanceof Error ? error.message : String(error)}`;
            await this.handlers.onError?.(new Error(errMsg));
        }
    }

    /*
        This function runs periodically and:

        - Tries to reconnect groups that have assets and are disconnected
        - Cleans up groups that have no assets
    */
    private async reconnectAndCleanupGroups() {
        try {
            const reconnectIds = await this.groupRegistry.getGroupsToReconnectAndCleanup();

            for (const groupId of reconnectIds) {
                await this.createWebSocketClient(groupId, this.handlers);
            }
        } catch (err) {
            await this.handlers.onError?.(err as Error);
        }
    }

    private async createWebSocketClient(groupId: string, handlers: WebSocketHandlers) {
        const group = this.groupRegistry.findGroupById(groupId);

        /*
            Should never happen, but just in case.
        */
        if (!group) {
            await handlers.onError?.(new Error(`Group ${groupId} not found in registry`));
            return;
        }

        const groupSocket = new GroupSocket(group, this.burstLimiter, this.bookCache, handlers);
        try {
            await groupSocket.connect();
        } catch (error) {
            const errorMessage = `Error creating WebSocket client for group ${groupId}: ${error instanceof Error ? error.message : String(error)}`;
            await handlers.onError?.(new Error(errorMessage));
        }
    }
}

export { WSSubscriptionManager, WebSocketHandlers };