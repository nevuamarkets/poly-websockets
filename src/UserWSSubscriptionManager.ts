import ms from 'ms';
import _ from 'lodash';
import Bottleneck from 'bottleneck';
import {
    UserWebSocketHandlers,
    OrderEvent,
    TradeEvent,
    PolymarketUserWSEvent
} from './types/PolymarketWebSocket';
import { UserSubscriptionManagerOptions, ApiCredentials } from './types/WebSocketSubscriptions';

import { UserGroupRegistry } from './modules/UserGroupRegistry';
import { UserGroupSocket } from './modules/UserGroupSocket';

import { logger } from './logger';

// Keeping a burst limit under 10/s to avoid rate limiting
// See https://docs.polymarket.com/quickstart/introduction/rate-limits#api-rate-limits
const BURST_LIMIT_PER_SECOND = 5;

const DEFAULT_RECONNECT_AND_CLEANUP_INTERVAL_MS = ms('10s');
const DEFAULT_MAX_MARKETS_PER_WS = 100;

export class UserWSSubscriptionManager {
    private handlers: UserWebSocketHandlers;
    private burstLimiter: Bottleneck;
    private groupRegistry: UserGroupRegistry;
    private reconnectAndCleanupIntervalMs: number;
    private maxMarketsPerWS: number;
    private options: UserSubscriptionManagerOptions;

    constructor(userHandlers: UserWebSocketHandlers, options: UserSubscriptionManagerOptions) {
        this.options = options;
        this.groupRegistry = new UserGroupRegistry();
        this.burstLimiter = options?.burstLimiter || new Bottleneck({
            reservoir: BURST_LIMIT_PER_SECOND,
            reservoirRefreshAmount: BURST_LIMIT_PER_SECOND,
            reservoirRefreshInterval: ms('1s'),
            maxConcurrent: BURST_LIMIT_PER_SECOND
        });

        this.reconnectAndCleanupIntervalMs = options?.reconnectAndCleanupIntervalMs || DEFAULT_RECONNECT_AND_CLEANUP_INTERVAL_MS;
        this.maxMarketsPerWS = options?.maxMarketsPerWS || DEFAULT_MAX_MARKETS_PER_WS;

        this.handlers = {
            onOrder: async (events: OrderEvent[]) => {
                await this.actOnSubscribedEvents(events, userHandlers.onOrder);
            },
            onTrade: async (events: TradeEvent[]) => {
                await this.actOnSubscribedEvents(events, userHandlers.onTrade);
            },
            onWSClose: userHandlers.onWSClose,
            onWSOpen: userHandlers.onWSOpen,
            onError: userHandlers.onError
        };

        this.burstLimiter.on('error', (err: Error) => {
            this.handlers.onError?.(err);
        });

        setInterval(this.reconnectAndCleanupGroups.bind(this), this.reconnectAndCleanupIntervalMs);
    }

    /**
     * Clears all WebSocket subscriptions and state.
     *
     * This will:
     *
     * 1. Remove all subscriptions and groups
     * 2. Close all WebSocket connections
     */
    public async clearState() {
        const removedGroups = await this.groupRegistry.clearAllGroups();
        for (const group of removedGroups) {
            try {
                if (group.wsClient) {
                    group.wsClient.close();
                }
            } catch (error) {
                await this.handlers.onError?.(new Error(`Error closing WebSocket for group ${group.groupId}: ${error instanceof Error ? error.message : String(error)}`));
            }
        }
    }

    /* 
        This function is called when:
        - a websocket event is received from the Polymarket User WS
        
        The user handlers will be called **ONLY** for markets that are actively subscribed to by any groups.
    */
    private async actOnSubscribedEvents<T extends PolymarketUserWSEvent>(events: T[], action?: (events: T[]) => Promise<void>) {
        if (!action) return;

        const subscribedEvents = events.filter(event => {
            // For user events, we check if the market is subscribed
            const marketId = event.market || '';
            return this.groupRegistry.hasMarket(marketId);
        });

        if (subscribedEvents.length > 0) {
            await action(subscribedEvents);
        }
    }

    /*  
        Edits wsGroups: Adds new subscriptions.

        - Filters out markets that are already subscribed
        - Finds a group with capacity or creates a new one
        - Creates a new WebSocket client and adds it to the group
    */
    public async addSubscriptions(marketIdsToAdd: string[]) {
        try {
            const groupIdsToConnect = await this.groupRegistry.addMarkets(marketIdsToAdd, this.maxMarketsPerWS, this.options.auth);
            for (const groupId of groupIdsToConnect) {
                await this.createWebSocketClient(groupId, this.handlers);
            }
        } catch (error) {
            const msg = `Error adding user subscriptions: ${error instanceof Error ? error.message : String(error)}`;
            await this.handlers.onError?.(new Error(msg));
        }
    }

    /*  
        Edits wsGroups: Removes subscriptions.
        The group will use the updated subscriptions when it reconnects.
        We do that because we don't want to miss events by reconnecting.
    */
    public async removeSubscriptions(marketIdsToRemove: string[]) {
        try {
            await this.groupRegistry.removeMarkets(marketIdsToRemove);
        } catch (error) {
            const msg = `Error removing user subscriptions: ${error instanceof Error ? error.message : String(error)}`;
            await this.handlers.onError?.(new Error(msg));
        }
    }

    /*
        This function runs periodically and:
        - Tries to reconnect groups that have markets and are disconnected
        - Cleans up groups that have no markets
    */
    private async reconnectAndCleanupGroups() {
        try {
            const reconnectIds = await this.groupRegistry.getGroupsToReconnectAndCleanup();
            for (const groupId of reconnectIds) {
                await this.createWebSocketClient(groupId, this.handlers);
            }
        } catch (error) {
            const msg = `Error during user group reconnection and cleanup: ${error instanceof Error ? error.message : String(error)}`;
            await this.handlers.onError?.(new Error(msg));
        }
    }

    private async createWebSocketClient(groupId: string, handlers: UserWebSocketHandlers) {
        const group = this.groupRegistry.findGroupById(groupId);

        /*
            Should never happen, but just in case.
        */
        if (!group) {
            await handlers.onError?.(new Error(`User group ${groupId} not found in registry`));
            return;
        }

        const groupSocket = new UserGroupSocket(group, this.burstLimiter, handlers);
        try {
            await groupSocket.connect();
        } catch (error) {
            const errorMessage = `Error creating User WebSocket client for group ${groupId}: ${error instanceof Error ? error.message : String(error)}`;
            await handlers.onError?.(new Error(errorMessage));
        }
    }
}

export { UserWebSocketHandlers } from './types/PolymarketWebSocket';
export { UserSubscriptionManagerOptions, ApiCredentials } from './types/WebSocketSubscriptions';