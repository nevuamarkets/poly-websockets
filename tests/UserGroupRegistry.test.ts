import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserGroupRegistry } from '../src/modules/UserGroupRegistry';
import { ApiCredentials, WebSocketStatus } from '../src/types/WebSocketSubscriptions';

describe('UserGroupRegistry', () => {
    let registry: UserGroupRegistry;
    let mockAuth: ApiCredentials;

    beforeEach(async () => {
        registry = new UserGroupRegistry();
        mockAuth = {
            apiKey: 'test-api-key',
            secret: 'test-secret',
            passphrase: 'test-passphrase'
        };
        
        // Clear any existing state
        await registry.clearAllGroups();
    });

    afterEach(async () => {
        // Clean up after each test
        await registry.clearAllGroups();
    });

    describe('basic operations', () => {
        it('should start empty', () => {
            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(0);
        });

        it('should add markets and create groups', async () => {
            const marketIds = ['market1', 'market2'];
            const groupIds = await registry.addMarkets(marketIds, 100, mockAuth);

            expect(groupIds).toHaveLength(1);
            
            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(1);
            expect(snapshot[0].marketIds.has('market1')).toBe(true);
            expect(snapshot[0].marketIds.has('market2')).toBe(true);
            expect(snapshot[0].auth).toEqual(mockAuth);
        });

        it('should not add duplicate markets', async () => {
            await registry.addMarkets(['market1'], 100, mockAuth);
            const groupIds = await registry.addMarkets(['market1'], 100, mockAuth);

            expect(groupIds).toHaveLength(0);
            
            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(1);
        });

        it('should create multiple groups when exceeding max per WS', async () => {
            const marketIds = ['market1', 'market2', 'market3'];
            const groupIds = await registry.addMarkets(marketIds, 2, mockAuth);

            expect(groupIds).toHaveLength(2);
            
            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(2);
        });

        it('should check if market exists', async () => {
            await registry.addMarkets(['market1'], 100, mockAuth);

            expect(registry.hasMarket('market1')).toBe(true);
            expect(registry.hasMarket('market2')).toBe(false);
        });

        it('should find group by id', async () => {
            const groupIds = await registry.addMarkets(['market1'], 100, mockAuth);
            const groupId = groupIds[0];

            const group = registry.findGroupById(groupId);
            expect(group).toBeDefined();
            expect(group?.groupId).toBe(groupId);
        });

        it('should return undefined for non-existent group', () => {
            const group = registry.findGroupById('non-existent');
            expect(group).toBeUndefined();
        });
    });

    describe('subscription management', () => {
        it('should remove markets', async () => {
            await registry.addMarkets(['market1', 'market2'], 100, mockAuth);
            await registry.removeMarkets(['market1']);

            expect(registry.hasMarket('market1')).toBe(false);
            expect(registry.hasMarket('market2')).toBe(true);
        });

        it('should mark groups for cleanup when all markets removed', async () => {
            await registry.addMarkets(['market1'], 100, mockAuth);
            await registry.removeMarkets(['market1']);

            const snapshot = registry.snapshot();
            expect(snapshot[0].status).toBe(WebSocketStatus.CLEANUP);
        });

        it('should clear all groups', async () => {
            await registry.addMarkets(['market1', 'market2'], 100, mockAuth);
            const removedGroups = await registry.clearAllGroups();

            expect(removedGroups).toHaveLength(1);
            expect(registry.snapshot()).toHaveLength(0);
        });
    });

    describe('group capacity management', () => {
        it('should find group with capacity', async () => {
            await registry.addMarkets(['market1'], 100, mockAuth);
            const groupId = registry.findGroupWithCapacity(50, 100);

            expect(groupId).toBeDefined();
        });

        it('should return null when no group has capacity', async () => {
            await registry.addMarkets(['market1'], 2, mockAuth);
            const groupId = registry.findGroupWithCapacity(5, 2);

            expect(groupId).toBeNull();
        });

        it('should ignore empty groups when finding capacity', async () => {
            // Create a group and then remove all its markets
            await registry.addMarkets(['market1'], 100, mockAuth);
            await registry.removeMarkets(['market1']);
            
            const groupId = registry.findGroupWithCapacity(1, 100);
            expect(groupId).toBeNull();
        });
    });

    describe('reconnection and cleanup', () => {
        it('should identify groups needing reconnection', async () => {
            const groupIds = await registry.addMarkets(['market1'], 100, mockAuth);
            
            // Manually set status to DEAD
            await registry.mutate(groups => {
                const group = groups.find(g => g.groupId === groupIds[0]);
                if (group) group.status = WebSocketStatus.DEAD;
            });

            const reconnectIds = await registry.getGroupsToReconnectAndCleanup();
            expect(reconnectIds).toContain(groupIds[0]);
        });

        it('should remove groups marked for cleanup', async () => {
            await registry.addMarkets(['market1'], 100, mockAuth);
            await registry.removeMarkets(['market1']); // This marks for cleanup

            await registry.getGroupsToReconnectAndCleanup();
            
            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(0);
        });

        it('should not reconnect groups with no markets', async () => {
            const groupIds = await registry.addMarkets(['market1'], 100, mockAuth);
            
            // Remove markets and set to DEAD
            await registry.removeMarkets(['market1']);
            await registry.mutate(groups => {
                const group = groups.find(g => g.groupId === groupIds[0]);
                if (group) group.status = WebSocketStatus.DEAD;
            });

            const reconnectIds = await registry.getGroupsToReconnectAndCleanup();
            expect(reconnectIds).not.toContain(groupIds[0]);
        });
    });

    describe('concurrent access', () => {
        it('should handle concurrent mutations safely', async () => {
            const promises = [
                registry.addMarkets(['market1'], 100, mockAuth),
                registry.addMarkets(['market2'], 100, mockAuth),
                registry.addMarkets(['market3'], 100, mockAuth)
            ];

            await Promise.all(promises);

            expect(registry.hasMarket('market1')).toBe(true);
            expect(registry.hasMarket('market2')).toBe(true);
            expect(registry.hasMarket('market3')).toBe(true);
        });

        it('should handle large number of markets with unlimited default (Number.MAX_SAFE_INTEGER)', async () => {
            // Test that we can add 1000 markets and they all go into a single group when using unlimited capacity
            const manyMarkets = Array.from({ length: 1000 }, (_, i) => `market${i}`);
            const groupIds = await registry.addMarkets(manyMarkets, Number.MAX_SAFE_INTEGER, mockAuth);
            
            expect(groupIds).toHaveLength(1);
            const snapshot = registry.snapshot();
            expect(snapshot).toHaveLength(1);
            
            const group = snapshot[0];
            expect(group.marketIds.size).toBe(1000);
            
            // Verify all markets are present
            manyMarkets.forEach(market => {
                expect(group.marketIds.has(market)).toBe(true);
            });
        });
    });
});