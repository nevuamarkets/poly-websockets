import { Mutex } from 'async-mutex';
import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { UserWebSocketGroup, WebSocketStatus, ApiCredentials } from '../types/WebSocketSubscriptions';
import { logger } from '../logger';

/*
 * Global user group store and mutex
 */
const userWsGroups: UserWebSocketGroup[] = [];
const userWsGroupsMutex = new Mutex();

export class UserGroupRegistry {

    /** 
     * Atomic mutate helper.
     * 
     * @param fn - The function to run atomically.
     * @returns The result of the function.
     */
    public async mutate<T>(fn: (groups: UserWebSocketGroup[]) => T | Promise<T>): Promise<T> {
        const release = await userWsGroupsMutex.acquire();
        try { return await fn(userWsGroups); }
        finally { release(); }
    }

    /** 
     * Read-only copy of the registry.
     * 
     * Only to be used in test suite.
     */
    public snapshot(): UserWebSocketGroup[] {
        return userWsGroups.map(group => ({
            ...group,
            marketIds: new Set(group.marketIds),
            auth: { ...group.auth }
        }));
    }

    /**
     * Find the first group with capacity to hold new markets.
     * 
     * Returns the groupId if found, otherwise null.
     */
    public findGroupWithCapacity(newMarketLen: number, maxPerWS: number): string | null {
        for (const group of userWsGroups) {
            // Skip subscribe-to-all groups and empty groups
            if (group.marketIds.size === 0 || group.subscribeToAll) continue;
            if (group.marketIds.size + newMarketLen <= maxPerWS) return group.groupId;
        }
        return null;
    }

    /**
     * Check if any group contains the market or if any group is configured to subscribe to all.
     */
    public hasMarket(marketId: string): boolean {
        return userWsGroups.some(group => group.marketIds.has(marketId) || group.subscribeToAll);
    }

    /**
     * Check if any group is configured to subscribe to all events.
     */
    public hasSubscribeToAll(): boolean {
        return userWsGroups.some(group => group.subscribeToAll);
    }

    /**
     * Find the group by groupId.
     * 
     * Returns the group if found, otherwise undefined.
     */
    public findGroupById(groupId: string): UserWebSocketGroup | undefined {
        return userWsGroups.find(g => g.groupId === groupId);
    }

    /**
     * Atomically remove **all** groups from the registry and return them so the
     * caller can perform any asynchronous cleanup (closing sockets, etc.)
     * outside the lock. 
     * 
     * Returns the removed groups.
     */
    public async clearAllGroups(): Promise<UserWebSocketGroup[]> {
        let removed: UserWebSocketGroup[] = [];
        await this.mutate(groups => {
            removed = [...groups];
            groups.length = 0;
        });
        return removed;
    }

    /**
     * Add new market subscriptions.
     * 
     * – Ignores markets that are already subscribed.
     * – Either reuses an existing group with capacity or creates new groups (size ≤ maxPerWS).
     * – If marketIds is empty, creates a "subscribe to all" group.
     * 
     * @param marketIds - The marketIds to add. Empty array means subscribe to all events.
     * @param maxPerWS - The maximum number of markets per WebSocket group.
     * @param auth - Authentication credentials.
     * @returns An array of *new* groupIds that need websocket connections.
     */
    public async addMarkets(marketIds: string[], maxPerWS: number, auth: ApiCredentials): Promise<string[]> {
        const groupIdsToConnect: string[] = [];
        let newMarketIds: string[] = []

        await this.mutate(groups => {
            // Handle "subscribe to all" case
            if (marketIds.length === 0) {
                // Check if we already have a "subscribe to all" group
                const existingSubscribeToAllGroup = groups.find(g => g.subscribeToAll);
                if (existingSubscribeToAllGroup) {
                    return; // Already have a subscribe-to-all group
                }

                // Create a new "subscribe to all" group
                const groupId = uuidv4();
                const group: UserWebSocketGroup = {
                    groupId,
                    marketIds: new Set(),
                    wsClient: null,
                    status: WebSocketStatus.PENDING,
                    auth: { ...auth },
                    subscribeToAll: true
                };
                groups.push(group);
                groupIdsToConnect.push(groupId);
                return;
            }

            // Regular market subscription logic
            newMarketIds = marketIds.filter(id => !groups.some(g => g.marketIds.has(id)));
            if (newMarketIds.length === 0) return;

            // Create new groups to accommodate the new markets
            const chunks = _.chunk(newMarketIds, maxPerWS);
            for (const chunk of chunks) {
                const groupId = uuidv4();
                const group: UserWebSocketGroup = {
                    groupId,
                    marketIds: new Set(chunk),
                    wsClient: null,
                    status: WebSocketStatus.PENDING,
                    auth: { ...auth }
                };
                groups.push(group);
                groupIdsToConnect.push(groupId);
            }
        });

        if (marketIds.length === 0) {
            logger.info({
                message: 'Added user "subscribe to all" subscription',
                groupsToConnect: groupIdsToConnect.length
            });
        } else {
            logger.info({
                message: 'Added user market subscriptions',
                newMarkets: newMarketIds.length,
                groupsToConnect: groupIdsToConnect.length
            });
        }

        return groupIdsToConnect;
    }

    /**
     * Remove market subscriptions.
     * 
     * @param marketIds - The marketIds to remove.
     * @returns An array of groupIds that were affected.
     */
    public async removeMarkets(marketIds: string[]): Promise<string[]> {
        const affectedGroupIds: string[] = [];

        await this.mutate(groups => {
            for (const marketId of marketIds) {
                const groupIndices = groups.map((g, i) => g.marketIds.has(marketId) ? i : -1).filter(i => i !== -1);
                for (const index of groupIndices) {
                    const group = groups[index];
                    if (group) {
                        group.marketIds.delete(marketId);
                        if (!affectedGroupIds.includes(group.groupId)) {
                            affectedGroupIds.push(group.groupId);
                        }
                        // Mark groups with no markets for cleanup (except subscribe-to-all groups)
                        if (group.marketIds.size === 0 && !group.subscribeToAll) {
                            group.status = WebSocketStatus.CLEANUP;
                        }
                    }
                }
            }
        });

        logger.info({
            message: 'Removed user market subscriptions',
            removedMarkets: marketIds.length,
            affectedGroups: affectedGroupIds.length
        });

        return affectedGroupIds;
    }

    /**
     * Get groups that need reconnection or cleanup.
     * 
     * @returns An array of groupIds that need to be processed.
     */
    public async getGroupsToReconnectAndCleanup(): Promise<string[]> {
        const groupIds: string[] = [];

        await this.mutate(groups => {
            for (let i = groups.length - 1; i >= 0; i--) {
                const group = groups[i];
                if (!group) continue;

                if (group.status === WebSocketStatus.CLEANUP || (group.marketIds.size === 0 && !group.subscribeToAll)) {
                    // Remove groups marked for cleanup or empty groups (except subscribe-to-all groups)
                    groups.splice(i, 1);
                } else if (group.status === WebSocketStatus.DEAD && (group.marketIds.size > 0 || group.subscribeToAll)) {
                    // Groups that need reconnection (either have markets or are subscribe-to-all)
                    groupIds.push(group.groupId);
                }
            }
        });

        return groupIds;
    }
}