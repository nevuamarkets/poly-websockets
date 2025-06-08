import { Mutex } from 'async-mutex';
import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketGroup, WebSocketStatus } from '../types/WebSocketSubscriptions';
import { OrderBookCache } from './OrderBookCache';
import { logger } from '../logger';

/*
 * Global group store and mutex, intentionally **not** exported anymore to prevent
 * accidental external mutation.  All access should go through the helper methods
 * on GroupRegistry instead. 
 */
const wsGroups: WebSocketGroup[] = [];
const wsGroupsMutex = new Mutex();

export class GroupRegistry {

    /** 
     * Atomic mutate helper.
     * 
     * @param fn - The function to run atomically.
     * @returns The result of the function.
     */
    public async mutate<T>(fn: (groups: WebSocketGroup[]) => T | Promise<T>): Promise<T> {
        const release = await wsGroupsMutex.acquire();
        try { return await fn(wsGroups); }
        finally { release(); }
    }

    /** 
     * Read-only copy of the registry.
     * 
     * Only to be used in test suite.
     */
    public snapshot(): WebSocketGroup[] {
        return wsGroups.map(group => ({
            ...group,
            assetIds: new Set(group.assetIds),
        }));
    }

    /**
     * Find the first group with capacity to hold new assets.
     * 
     * Returns the groupId if found, otherwise null.
     */
    public findGroupWithCapacity(newAssetLen: number, maxPerWS: number): string | null {
        for (const group of wsGroups) {
            if (group.assetIds.size === 0) continue;
            if (group.assetIds.size + newAssetLen <= maxPerWS) return group.groupId;
        }
        return null;
    }

    /**
     * Get the indices of all groups that contain the asset.
     * 
     * Returns an array of indices.
     */
    public getGroupIndicesForAsset(assetId: string): number[] {
        const indices: number[] = [];
        for (let i = 0; i < wsGroups.length; i++) {
            if (wsGroups[i]?.assetIds.has(assetId)) indices.push(i);
        }
        return indices;
    }

    /**
     * Check if any group contains the asset.
     */
    public hasAsset(assetId: string): boolean {
        return wsGroups.some(group => group.assetIds.has(assetId));
    }

    /**
     * Find the group by groupId.
     * 
     * Returns the group if found, otherwise undefined.
     */
    public findGroupById(groupId: string): WebSocketGroup | undefined {
        return wsGroups.find(g => g.groupId === groupId);
    }

    /**
     * Atomically remove **all** groups from the registry and return them so the
     * caller can perform any asynchronous cleanup (closing sockets, etc.)
     * outside the lock. 
     * 
     * Returns the removed groups.
     */
    public async clearAllGroups(): Promise<WebSocketGroup[]> {
        let removed: WebSocketGroup[] = [];
        await this.mutate(groups => {
            removed = [...groups];
            groups.length = 0;
        });
        return removed;
    }

    /**
     * Add new asset subscriptions.
     * 
     * – Ignores assets that are already subscribed.
     * – Either reuses an existing group with capacity or creates new groups (size ≤ maxPerWS).
     * – If appending to a group:
     *  - A new group is created with the updated assetIds.
     *  - The old group is marked for cleanup.
     *  - The group is added to the list of groups to connect.
     * 
     * @param assetIds - The assetIds to add.
     * @param maxPerWS - The maximum number of assets per WebSocket group.
     * @returns An array of *new* groupIds that need websocket connections.
     */
    public async addAssets(assetIds: string[], maxPerWS: number): Promise<string[]> {
        const groupIdsToConnect: string[] = [];
        let newAssetIds: string[] = []

        await this.mutate(groups => {
            newAssetIds = assetIds.filter(id => !groups.some(g => g.assetIds.has(id)));
            if (newAssetIds.length === 0) return;

            const existingGroupId = this.findGroupWithCapacity(newAssetIds.length, maxPerWS);

            /*
                If no existing group with capacity is found, create new groups.
            */
            if (existingGroupId === null) {
                const chunks = _.chunk(newAssetIds, maxPerWS);
                for (const chunk of chunks) {
                    const groupId = uuidv4();
                    groups.push(
                        { 
                            groupId, 
                            assetIds: new Set(chunk), 
                            wsClient: null, 
                            status: WebSocketStatus.PENDING 
                        }
                    );
                    groupIdsToConnect.push(groupId);
                }

            /*
                If an existing group with capacity is found, update the group.
            */
            } else {
                const existingGroup = groups.find(g => g.groupId === existingGroupId);
                if (!existingGroup) {
                    // Should never happen
                    throw new Error(`Group with capacity not found for ${newAssetIds.join(', ')}`);
                }

                const updatedAssetIds = new Set([...existingGroup.assetIds, ...newAssetIds]);

                // Mark old group ready for cleanup
                existingGroup.assetIds = new Set();
                existingGroup.status = WebSocketStatus.CLEANUP;

                const groupId = uuidv4();
                groups.push(
                    { 
                        groupId, 
                        assetIds: updatedAssetIds, 
                        wsClient: null, 
                        status: WebSocketStatus.PENDING 
                    }
                );
                groupIdsToConnect.push(groupId);
            }
        });

        if (newAssetIds.length > 0) {
            logger.info({
                message: `Added ${newAssetIds.length} new asset(s)`
            })
        }
        return groupIdsToConnect;
    }

    /**
     * Remove asset subscriptions from every group that contains the asset.
     * 
     * It should be only one group that contains the asset, we search all of them
     * regardless.
     * 
     * Returns the list of assetIds that were removed.
     */
    public async removeAssets(assetIds: string[], bookCache: OrderBookCache): Promise<string[]> {
        const removedAssetIds: string[] = [];
        await this.mutate(groups => {
            groups.forEach(group => {
                if (group.assetIds.size === 0) return;

                assetIds.forEach(id => {
                    if (group.assetIds.delete(id)) {
                        bookCache.clear(id);
                        removedAssetIds.push(id)
                    }
                });
            });
        });
        if (removedAssetIds.length > 0) {
            logger.info({
                message: `Removed ${removedAssetIds.length} asset(s)`
            })
        }
        return removedAssetIds;
    }

    /**
     * Disconnect a group.
     */
    public disconnectGroup(group: WebSocketGroup) {
        group.wsClient?.close();
        group.wsClient = null;

        logger.info({
            message: 'Disconnected group',
            groupId: group.groupId,
            assetIds: Array.from(group.assetIds),
        });

    };
    /**
     * Check status of groups and reconnect or cleanup as needed.
     * 
     * – Empty groups are removed from the global array and returned.
     * – Dead (but non-empty) groups are reset so that caller can reconnect them.
     * – Pending groups are returned so that caller can connect them.
     * 
     * Returns an array of group IDs that need to be reconnected, after cleaning up empty and cleanup-marked groups.
     */
    public async getGroupsToReconnectAndCleanup(): Promise<string[]> {
        const reconnectIds: string[] = [];

        await this.mutate(groups => {
            const groupsToRemove = new Set<string>();

            for (const group of groups) {
                if (group.assetIds.size === 0) {
                    groupsToRemove.add(group.groupId);
                    continue;
                }

                if (group.status === WebSocketStatus.ALIVE) {
                    continue;
                }

                if (group.status === WebSocketStatus.DEAD) {
                    this.disconnectGroup(group);
                    reconnectIds.push(group.groupId);
                }
                if (group.status === WebSocketStatus.CLEANUP) {
                    groupsToRemove.add(group.groupId);
                    group.assetIds = new Set();
                    continue;
                }

                if (group.status === WebSocketStatus.PENDING) {
                    reconnectIds.push(group.groupId);
                }
            }
            if (groupsToRemove.size > 0) {
                groups.forEach(group => {
                    if (groupsToRemove.has(group.groupId)) {
                        this.disconnectGroup(group);
                    }
                });
                const remaining = groups.filter(group => !groupsToRemove.has(group.groupId));
                groups.splice(0, groups.length, ...remaining);
            }
        });
        return reconnectIds;
    }
} 