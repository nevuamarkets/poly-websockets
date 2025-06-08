/// <reference types="vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GroupRegistry } from '../src/modules/GroupRegistry';
import { OrderBookCache } from '../src/modules/OrderBookCache';
import { WebSocketGroup, WebSocketStatus } from '../src/types/WebSocketSubscriptions';
import WebSocket from 'ws';

const makeGroup = (id: string, size: number): WebSocketGroup => ({
    groupId: id,
    assetIds: new Set(Array.from({ length: size }).map((_, i) => `${id}-asset-${i}`)),
    wsClient: null,
    status: WebSocketStatus.ALIVE,
});

const makeGroupWithAssets = (id: string, assetIds: string[]): WebSocketGroup => ({
    groupId: id,
    assetIds: new Set(assetIds),
    wsClient: null,
    status: WebSocketStatus.ALIVE,
});

describe('GroupRegistry', () => {
    let registry: GroupRegistry;
    let mockBookCache: OrderBookCache;

    beforeEach(async () => {
        registry = new GroupRegistry();
        await registry.clearAllGroups(); // ensure a clean slate for each test
        mockBookCache = new OrderBookCache();
        vi.clearAllMocks();
    });

    describe('mutate', () => {
        it('should synchronously modify group list', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroup('g1', 1));
                groups.push(makeGroup('g2', 50));
            });

            expect(registry.snapshot().length).toBe(2);
        });

        it('should support async operations within mutate', async () => {
            const result = await registry.mutate(async (groups) => {
                groups.push(makeGroup('g1', 1));
                await new Promise(resolve => setTimeout(resolve, 1));
                return 'async-result';
            });

            expect(result).toBe('async-result');
            expect(registry.snapshot().length).toBe(1);
        });

        it('should handle exceptions and release mutex', async () => {
            await expect(registry.mutate(() => {
                throw new Error('Test error');
            })).rejects.toThrow('Test error');

            // Should still be able to use registry after exception
            await registry.mutate(groups => {
                groups.push(makeGroup('g1', 1));
            });
            expect(registry.snapshot().length).toBe(1);
        });
    });

    describe('findGroupWithCapacity', () => {
        it('should respect MAX limit and find alive groups', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroup('alive', 10));
                const dead = makeGroup('dead', 5);
                dead.status = WebSocketStatus.DEAD;
                groups.push(dead);
            });

            const id = registry.findGroupWithCapacity(5, 100);
            expect(id).toBe('alive');

            const none = registry.findGroupWithCapacity(100, 100);
            expect(none).toBeNull();
        });

        it('should return null for empty groups', async () => {
            await registry.mutate(groups => {
                const emptyGroup = makeGroup('empty', 0);
                emptyGroup.assetIds = new Set();
                groups.push(emptyGroup);
            });

            const id = registry.findGroupWithCapacity(1, 100);
            expect(id).toBeNull();
        });

        it('should find group with exact capacity', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroup('exact', 5));
            });

            const id = registry.findGroupWithCapacity(5, 10);
            expect(id).toBe('exact');
        });

        it('should return null if no group has sufficient capacity', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroup('small1', 8));
                groups.push(makeGroup('small2', 9));
            });

            const id = registry.findGroupWithCapacity(3, 10);
            expect(id).toBeNull();
        });
    });

    describe('getGroupIndicesForAsset', () => {
        it('should return correct indices for asset in multiple groups', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroupWithAssets('g1', ['asset1', 'asset2']));
                groups.push(makeGroupWithAssets('g2', ['asset3', 'asset4']));
                groups.push(makeGroupWithAssets('g3', ['asset1', 'asset5']));
            });

            const indices = registry.getGroupIndicesForAsset('asset1');
            expect(indices).toEqual([0, 2]);
        });

        it('should return empty array for non-existent asset', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroupWithAssets('g1', ['asset1', 'asset2']));
            });

            const indices = registry.getGroupIndicesForAsset('non-existent');
            expect(indices).toEqual([]);
        });

        it('should return single index for asset in one group', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroupWithAssets('g1', ['asset1', 'asset2']));
                groups.push(makeGroupWithAssets('g2', ['asset3', 'asset4']));
            });

            const indices = registry.getGroupIndicesForAsset('asset2');
            expect(indices).toEqual([0]);
        });
    });

    describe('hasAsset', () => {
        it('should return true for existing asset', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroupWithAssets('g1', ['asset1', 'asset2']));
            });

            expect(registry.hasAsset('asset1')).toBe(true);
            expect(registry.hasAsset('asset2')).toBe(true);
        });

        it('should return false for non-existent asset', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroupWithAssets('g1', ['asset1', 'asset2']));
            });

            expect(registry.hasAsset('non-existent')).toBe(false);
        });

        it('should return false for empty registry', () => {
            expect(registry.hasAsset('any-asset')).toBe(false);
        });
    });

    describe('findGroupById', () => {
        it('should return group for existing groupId', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroupWithAssets('target-group', ['asset1']));
                groups.push(makeGroupWithAssets('other-group', ['asset2']));
            });

            const group = registry.findGroupById('target-group');
            expect(group).toBeDefined();
            expect(group?.groupId).toBe('target-group');
            expect(group?.assetIds.has('asset1')).toBe(true);
        });

        it('should return undefined for non-existent groupId', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroupWithAssets('existing-group', ['asset1']));
            });

            const group = registry.findGroupById('non-existent');
            expect(group).toBeUndefined();
        });
    });

    describe('clearAllGroups', () => {
        it('should remove all groups and return them', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroup('g1', 2));
                groups.push(makeGroup('g2', 3));
            });

            const removed = await registry.clearAllGroups();
            expect(removed).toHaveLength(2);
            expect(removed[0].groupId).toBe('g1');
            expect(removed[1].groupId).toBe('g2');
            expect(registry.snapshot()).toHaveLength(0);
        });

        it('should return empty array for empty registry', async () => {
            const removed = await registry.clearAllGroups();
            expect(removed).toEqual([]);
        });
    });

    describe('addAssets', () => {
        it('should create new group when no existing group has capacity', async () => {
            const groupIds = await registry.addAssets(['asset1', 'asset2'], 10);
            
            expect(groupIds).toHaveLength(1);
            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(1);
            expect(snapshot[0].assetIds.has('asset1')).toBe(true);
            expect(snapshot[0].assetIds.has('asset2')).toBe(true);
            expect(snapshot[0].status).toBe(WebSocketStatus.PENDING);
        });

        it('should create multiple groups when assets exceed maxPerWS', async () => {
            const groupIds = await registry.addAssets(['a1', 'a2', 'a3', 'a4', 'a5'], 2);
            
            expect(groupIds).toHaveLength(3);
            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(3);
            
            const allAssets = new Set<string>();
            snapshot.forEach(group => {
                group.assetIds.forEach(asset => allAssets.add(asset));
            });
            expect(allAssets.size).toBe(5);
        });

        it('should reuse existing group with capacity', async () => {
            // First add some assets
            await registry.addAssets(['asset1', 'asset2'], 10);
            
            // Then add more assets that should fit in existing group
            const groupIds = await registry.addAssets(['asset3', 'asset4'], 10);
            
            expect(groupIds).toHaveLength(1);
            const snapshot = registry.snapshot();
            
            // Should have original group marked for cleanup + new group with all assets
            expect(snapshot).toHaveLength(2);
            
            const newGroup = snapshot.find(g => g.assetIds.size === 4);
            expect(newGroup).toBeDefined();
            expect(newGroup?.assetIds.has('asset1')).toBe(true);
            expect(newGroup?.assetIds.has('asset2')).toBe(true);
            expect(newGroup?.assetIds.has('asset3')).toBe(true);
            expect(newGroup?.assetIds.has('asset4')).toBe(true);
            
            const cleanupGroup = snapshot.find(g => g.status === WebSocketStatus.CLEANUP);
            expect(cleanupGroup).toBeDefined();
            expect(cleanupGroup?.assetIds.size).toBe(0);
        });

        it('should ignore already subscribed assets', async () => {
            await registry.addAssets(['asset1', 'asset2'], 10);
            
            // Try to add same assets again plus new ones
            const groupIds = await registry.addAssets(['asset1', 'asset3'], 10);
            
            expect(groupIds).toHaveLength(1);
            const snapshot = registry.snapshot();
            
            // Should have the updated group with all 3 assets
            const newGroup = snapshot.find(g => g.assetIds.size === 3);
            expect(newGroup).toBeDefined();
            expect(newGroup?.assetIds.has('asset1')).toBe(true);
            expect(newGroup?.assetIds.has('asset2')).toBe(true);
            expect(newGroup?.assetIds.has('asset3')).toBe(true);
        });

        it('should return empty array when all assets already exist', async () => {
            await registry.addAssets(['asset1', 'asset2'], 10);
            
            const groupIds = await registry.addAssets(['asset1', 'asset2'], 10);
            
            expect(groupIds).toEqual([]);
        });

        it('should handle edge case when existing group is found but not in array', async () => {
            // This tests the error case in addAssets when findGroupWithCapacity returns
            // a groupId but the group is not found in the array (should never happen)
            await registry.mutate(groups => {
                const group = makeGroup('test', 5);
                groups.push(group);
            });
            
            // Mock findGroupWithCapacity to return a non-existent groupId
            const originalFind = registry.findGroupWithCapacity;
            registry.findGroupWithCapacity = vi.fn().mockReturnValue('non-existent-id');
            
            await expect(registry.addAssets(['new-asset'], 10))
                .rejects.toThrow('Group with capacity not found');
                
            // Restore original method
            registry.findGroupWithCapacity = originalFind;
        });
    });

    describe('removeAssets', () => {
        it('should remove assets from groups and clear cache', async () => {
            const mockClear = vi.spyOn(mockBookCache, 'clear');
            
            await registry.mutate(groups => {
                groups.push(makeGroupWithAssets('g1', ['asset1', 'asset2', 'asset3']));
                groups.push(makeGroupWithAssets('g2', ['asset4', 'asset5']));
            });

            const removedIds = await registry.removeAssets(['asset1', 'asset4'], mockBookCache);
            
            expect(mockClear).toHaveBeenCalledWith('asset1');
            expect(mockClear).toHaveBeenCalledWith('asset4');
            expect(mockClear).toHaveBeenCalledTimes(2);
            
            const snapshot = registry.snapshot();
            const g1 = snapshot.find(g => g.groupId === 'g1');
            const g2 = snapshot.find(g => g.groupId === 'g2');
            
            expect(g1?.assetIds.has('asset1')).toBe(false);
            expect(g1?.assetIds.has('asset2')).toBe(true);
            expect(g1?.assetIds.has('asset3')).toBe(true);
            
            expect(g2?.assetIds.has('asset4')).toBe(false);
            expect(g2?.assetIds.has('asset5')).toBe(true);
        });

        it('should handle removal of non-existent assets gracefully', async () => {
            const mockClear = vi.spyOn(mockBookCache, 'clear');
            
            await registry.mutate(groups => {
                groups.push(makeGroupWithAssets('g1', ['asset1', 'asset2']));
            });

            await registry.removeAssets(['non-existent', 'asset1'], mockBookCache);
            
            expect(mockClear).toHaveBeenCalledWith('asset1');
            expect(mockClear).toHaveBeenCalledTimes(1);
        });

        it('should ignore empty groups', async () => {
            const mockClear = vi.spyOn(mockBookCache, 'clear');
            
            await registry.mutate(groups => {
                const emptyGroup = makeGroup('empty', 0);
                emptyGroup.assetIds = new Set();
                groups.push(emptyGroup);
                groups.push(makeGroupWithAssets('g1', ['asset1']));
            });

            await registry.removeAssets(['asset1'], mockBookCache);
            
            expect(mockClear).toHaveBeenCalledWith('asset1');
            expect(mockClear).toHaveBeenCalledTimes(1);
        });
    });

    describe('disconnectGroup', () => {
        it('should close websocket and remove all listeners', () => {
            const mockWs = {
                close: vi.fn(),
                removeAllListeners: vi.fn()
            } as unknown as WebSocket;
            
            const group: WebSocketGroup = {
                groupId: 'test-group',
                assetIds: new Set(['asset1']),
                wsClient: mockWs,
                status: WebSocketStatus.ALIVE
            };

            registry.disconnectGroup(group);
            
            expect(mockWs.close).toHaveBeenCalled();
            expect(group.wsClient).toBeNull();
        });

        it('should handle group with null wsClient', () => {
            const group: WebSocketGroup = {
                groupId: 'test-group',
                assetIds: new Set(['asset1']),
                wsClient: null,
                status: WebSocketStatus.ALIVE
            };

            expect(() => registry.disconnectGroup(group)).not.toThrow();
            expect(group.wsClient).toBeNull();
        });
    });

    describe('reconnectOrCleanup', () => {
        it('should remove empty groups and return reconnect IDs for dead groups', async () => {
            await registry.mutate(groups => {
                // Empty group - should be removed
                const emptyGroup = makeGroup('empty', 0);
                emptyGroup.assetIds = new Set();
                groups.push(emptyGroup);
                
                // Dead group - should be disconnected and marked for reconnect
                const deadGroup = makeGroup('dead', 2);
                deadGroup.status = WebSocketStatus.DEAD;
                groups.push(deadGroup);
                
                // Alive group - should remain unchanged
                const aliveGroup = makeGroup('alive', 3);
                groups.push(aliveGroup);
                
                // Pending group - should be marked for reconnect
                const pendingGroup = makeGroup('pending', 1);
                pendingGroup.status = WebSocketStatus.PENDING;
                groups.push(pendingGroup);
                
                // Cleanup group - should be disconnected and removed
                const cleanupGroup = makeGroup('cleanup', 2);
                cleanupGroup.status = WebSocketStatus.CLEANUP;
                groups.push(cleanupGroup);
            });

            
            const reconnectIds = await registry.getGroupsToReconnectAndCleanup();
            
            expect(reconnectIds).toEqual(expect.arrayContaining(['dead', 'pending']));
            expect(reconnectIds).toHaveLength(2);
            
            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(3); // 2 out of 5 groups should be removed: the empty and the cleanup group
            expect(snapshot.some(g => g.groupId === 'alive')).toBe(true);
            expect(snapshot.some(g => g.groupId === 'dead')).toBe(true);
            expect(snapshot.some(g => g.groupId === 'empty')).toBe(false);
            expect(snapshot.some(g => g.groupId === 'cleanup')).toBe(false);
            expect(snapshot.some(g => g.groupId === 'pending')).toBe(true);
        });

        it('should handle registry with no groups needing cleanup', async () => {
            await registry.mutate(groups => {
                groups.push(makeGroup('alive1', 2));
                groups.push(makeGroup('alive2', 3));
            });

            const reconnectIds = await registry.getGroupsToReconnectAndCleanup();
            
            expect(reconnectIds).toEqual([]);
            expect(registry.snapshot()).toHaveLength(2);
        });

        it('should disconnect groups marked for cleanup or removal', async () => {
            const mockWs1 = { close: vi.fn() } as unknown as WebSocket;
            const mockWs2 = { close: vi.fn() } as unknown as WebSocket;
            
            await registry.mutate(groups => {
                const emptyGroup = makeGroup('empty', 0);
                emptyGroup.assetIds = new Set();
                emptyGroup.wsClient = mockWs1;
                groups.push(emptyGroup);
                
                const cleanupGroup = makeGroup('cleanup', 1);
                cleanupGroup.status = WebSocketStatus.CLEANUP;
                cleanupGroup.wsClient = mockWs2;
                groups.push(cleanupGroup);
            });

            await registry.getGroupsToReconnectAndCleanup();
            
            expect(mockWs1.close).toHaveBeenCalled();
            expect(mockWs2.close).toHaveBeenCalled();
        });
    });

    describe('snapshot', () => {
        it('should return deep copy preventing mutation', async () => {
            await registry.mutate(groups => groups.push(makeGroup('g', 1)));
            const snap = registry.snapshot();
            snap[0].assetIds.add('new-asset');

            const freshSnap = registry.snapshot();
            expect(freshSnap[0].assetIds.has('new-asset')).toBe(false);
        });

        it('should return empty array for empty registry', () => {
            const snapshot = registry.snapshot();
            expect(snapshot).toEqual([]);
        });

        it('should preserve all group properties in snapshot', async () => {
            const mockWs = {} as WebSocket;
            await registry.mutate(groups => {
                const group = makeGroupWithAssets('test', ['asset1', 'asset2']);
                group.wsClient = mockWs;
                group.status = WebSocketStatus.ALIVE;
                groups.push(group);
            });

            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(1);
            expect(snapshot[0].groupId).toBe('test');
            expect(snapshot[0].wsClient).toBe(mockWs);
            expect(snapshot[0].status).toBe(WebSocketStatus.ALIVE);
            expect(snapshot[0].assetIds.size).toBe(2);
            expect(snapshot[0].assetIds.has('asset1')).toBe(true);
            expect(snapshot[0].assetIds.has('asset2')).toBe(true);
        });
    });

    describe('integration scenarios', () => {
        it('should handle complete lifecycle: add -> remove -> cleanup', async () => {
            // Add assets
            let groupIds = await registry.addAssets(['asset1', 'asset2', 'asset3'], 10);
            expect(groupIds).toHaveLength(1);
            
            // Add more assets to same group
            groupIds = await registry.addAssets(['asset4'], 10);
            expect(groupIds).toHaveLength(1);
            
            // Remove some assets
            await registry.removeAssets(['asset2'], mockBookCache);
            
            // Verify state
            let snapshot = registry.snapshot();
            const activeGroup = snapshot.find(g => g.assetIds.size > 0);
            expect(activeGroup?.assetIds.has('asset1')).toBe(true);
            expect(activeGroup?.assetIds.has('asset2')).toBe(false);
            expect(activeGroup?.assetIds.has('asset3')).toBe(true);
            expect(activeGroup?.assetIds.has('asset4')).toBe(true);
            
            // Cleanup
            await registry.getGroupsToReconnectAndCleanup();
            snapshot = registry.snapshot();
            
            // Should only have groups with assets
            expect(snapshot.every(g => g.assetIds.size > 0)).toBe(true);
        });

        it('should handle concurrent asset operations correctly', async () => {
            // Simulate concurrent operations
            const operations = [
                registry.addAssets(['a1', 'a2'], 5),
                registry.addAssets(['a3', 'a4'], 5),
                registry.addAssets(['a5', 'a6'], 5)
            ];
            
            const results = await Promise.all(operations);
            
            // All operations should succeed
            expect(results.every(r => r.length > 0)).toBe(true);
            
            // All assets should be present
            const snapshot = registry.snapshot();
            const allAssets = new Set<string>();
            snapshot.forEach(group => {
                group.assetIds.forEach(asset => allAssets.add(asset));
            });
            
            expect(allAssets.size).toBe(6);
            expect(allAssets.has('a1')).toBe(true);
            expect(allAssets.has('a6')).toBe(true);
        });
    });
}); 