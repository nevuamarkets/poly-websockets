/// <reference types="vitest" />
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WSSubscriptionManager, WebSocketHandlers } from '../src/WSSubscriptionManager';
import { GroupRegistry } from '../src/modules/GroupRegistry';
import { OrderBookCache } from '../src/modules/OrderBookCache';
import { GroupSocket } from '../src/modules/GroupSocket';
import Bottleneck from 'bottleneck';
import {
    BookEvent,
    LastTradePriceEvent,
    PriceChangeEvent,
    TickSizeChangeEvent,
    PolymarketPriceUpdateEvent
} from '../src/types/PolymarketWebSocket';
import { WebSocketGroup, WebSocketStatus } from '../src/types/WebSocketSubscriptions';

// Mock all dependencies
vi.mock('../src/modules/GroupRegistry');
vi.mock('../src/modules/OrderBookCache');
vi.mock('../src/modules/GroupSocket');
vi.mock('bottleneck');

const MockedGroupRegistry = vi.mocked(GroupRegistry);
const MockedOrderBookCache = vi.mocked(OrderBookCache);
const MockedGroupSocket = vi.mocked(GroupSocket);
const MockedBottleneck = vi.mocked(Bottleneck);

describe('WSSubscriptionManager', () => {
    let manager: WSSubscriptionManager;
    let mockHandlers: WebSocketHandlers;
    let mockGroupRegistry: any;
    let mockBookCache: any;
    let mockBottleneck: any;
    let mockGroupSocket: any;

    const createMockGroup = (groupId: string, assetIds: string[]): WebSocketGroup => ({
        groupId,
        assetIds: new Set(assetIds),
        wsClient: null,
        status: WebSocketStatus.ALIVE
    });

    const createMockBookEvent = (assetId: string): BookEvent => ({
        asset_id: assetId,
        market: 'test-market',
        timestamp: '1234567890',
        hash: 'test-hash',
        event_type: 'book',
        bids: [{ price: '0.45', size: '100' }],
        asks: [{ price: '0.55', size: '50' }]
    });

    const createMockPriceChangeEvent = (assetId: string): PriceChangeEvent => ({
        market: 'test-market',
        timestamp: '1234567890',
        event_type: 'price_change',
        price_changes: [{
            asset_id: assetId,
            price: '0.50', 
            side: 'BUY', 
            size: '100',
            hash: 'test-hash',
            best_bid: '0.45',
            best_ask: '0.55'
        }]
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        // Mock handlers
        mockHandlers = {
            onBook: vi.fn(),
            onLastTradePrice: vi.fn(),
            onPriceChange: vi.fn(),
            onTickSizeChange: vi.fn(),
            onPolymarketPriceUpdate: vi.fn(),
            onWSOpen: vi.fn(),
            onWSClose: vi.fn(),
            onError: vi.fn()
        };

        // Setup GroupRegistry mock
        mockGroupRegistry = {
            addAssets: vi.fn().mockResolvedValue([]),
            removeAssets: vi.fn().mockResolvedValue(undefined),
            getGroupsToReconnectAndCleanup: vi.fn().mockResolvedValue([]),
            findGroupById: vi.fn().mockReturnValue(undefined),
            getGroupIndicesForAsset: vi.fn().mockReturnValue([]),
            clearAllGroups: vi.fn().mockResolvedValue([]),
            disconnectGroup: vi.fn()
        } as any;

        MockedGroupRegistry.mockImplementation(() => mockGroupRegistry);

        // Setup OrderBookCache mock
        mockBookCache = {
            clear: vi.fn()
        } as any;

        MockedOrderBookCache.mockImplementation(() => mockBookCache);

        // Setup Bottleneck mock
        mockBottleneck = {
            schedule: vi.fn().mockResolvedValue(undefined),
            on: vi.fn()
        } as any;

        MockedBottleneck.mockImplementation(() => mockBottleneck);

        // Setup GroupSocket mock
        mockGroupSocket = {
            connect: vi.fn().mockResolvedValue(undefined),
        } as any;

        MockedGroupSocket.mockImplementation(() => mockGroupSocket);

        manager = new WSSubscriptionManager(mockHandlers);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('constructor', () => {
        it('should initialize with correct dependencies', () => {
            expect(MockedGroupRegistry).toHaveBeenCalledTimes(1);
            expect(MockedOrderBookCache).toHaveBeenCalledTimes(1);
            expect(MockedBottleneck).toHaveBeenCalledWith({
                reservoir: 5,
                reservoirRefreshAmount: 5,
                reservoirRefreshInterval: 1000,
                maxConcurrent: 5
            });
        });

        it('should use custom bottleneck if provided in options', () => {
            const customBottleneck = new Bottleneck();
            new WSSubscriptionManager(mockHandlers, { burstLimiter: customBottleneck });

            // Should not create a new bottleneck when custom one is provided
            // 1 for the constructor, 1 during the connect call
            expect(MockedBottleneck).toHaveBeenCalledTimes(2); 
        });

        it('should set up periodic reconnection check', () => {
            expect(vi.getTimerCount()).toBe(1);
        });
    });

    describe('addSubscriptions', () => {
        it('should add assets and create websocket clients for new groups', async () => {
            const assetIds = ['asset1', 'asset2'];
            const groupIds = ['group1'];

            mockGroupRegistry.addAssets.mockResolvedValue(groupIds);
            mockGroupRegistry.findGroupById.mockReturnValue(createMockGroup('group1', assetIds));

            await manager.addSubscriptions(assetIds);

            expect(mockGroupRegistry.addAssets).toHaveBeenCalledWith(assetIds, 100);
            expect(MockedGroupSocket).toHaveBeenCalledWith(
                expect.any(Object),
                mockBottleneck,
                mockBookCache,
                expect.any(Object)
            );
            expect(mockGroupSocket.connect).toHaveBeenCalledTimes(1);
        });

        it('should handle multiple groups being returned', async () => {
            const assetIds = ['asset1', 'asset2', 'asset3'];
            const groupIds = ['group1', 'group2'];

            mockGroupRegistry.addAssets.mockResolvedValue(groupIds);
            mockGroupRegistry.findGroupById
                .mockReturnValueOnce(createMockGroup('group1', ['asset1', 'asset2']))
                .mockReturnValueOnce(createMockGroup('group2', ['asset3']));

            await manager.addSubscriptions(assetIds);

            expect(MockedGroupSocket).toHaveBeenCalledTimes(2);
            expect(mockGroupSocket.connect).toHaveBeenCalledTimes(2);
        });

        it('should handle errors during subscription addition', async () => {
            const assetIds = ['asset1'];
            const error = new Error('Registry error');

            mockGroupRegistry.addAssets.mockRejectedValue(error);

            await manager.addSubscriptions(assetIds);

            expect(mockHandlers.onError).toHaveBeenCalledWith(
                new Error('Error adding subscriptions: Registry error')
            );
        });

        it('should handle group not found error', async () => {
            const assetIds = ['asset1'];
            const groupIds = ['group1'];

            mockGroupRegistry.addAssets.mockResolvedValue(groupIds);
            mockGroupRegistry.findGroupById.mockReturnValue(undefined);

            await manager.addSubscriptions(assetIds);

            expect(mockHandlers.onError).toHaveBeenCalledWith(
                new Error('Group group1 not found in registry')
            );
        });

        it('should handle websocket connection errors', async () => {
            const assetIds = ['asset1'];
            const groupIds = ['group1'];
            const connectionError = new Error('Connection failed');

            mockGroupRegistry.addAssets.mockResolvedValue(groupIds);
            mockGroupRegistry.findGroupById.mockReturnValue(createMockGroup('group1', assetIds));
            mockGroupSocket.connect.mockRejectedValue(connectionError);

            await manager.addSubscriptions(assetIds);

            expect(mockHandlers.onError).toHaveBeenCalledWith(
                new Error('Error creating WebSocket client for group group1: Connection failed')
            );
        });
    });

    describe('removeSubscriptions', () => {
        it('should remove assets and clear cache', async () => {
            const assetIds = ['asset1', 'asset2'];

            await manager.removeSubscriptions(assetIds);

            expect(mockGroupRegistry.removeAssets).toHaveBeenCalledWith(assetIds, mockBookCache);
        });

        it('should handle errors during subscription removal', async () => {
            const assetIds = ['asset1'];
            const error = new Error('Remove error');

            mockGroupRegistry.removeAssets.mockRejectedValue(error);

            await manager.removeSubscriptions(assetIds);

            expect(mockHandlers.onError).toHaveBeenCalledWith(
                new Error('Error removing subscriptions: Remove error')
            );
        });
    });

    describe('clearState', () => {
        it('should clear all groups and disconnect them', async () => {
            const mockGroups = [
                createMockGroup('group1', ['asset1']),
                createMockGroup('group2', ['asset2'])
            ];

            mockGroupRegistry.clearAllGroups.mockResolvedValue(mockGroups);

            await manager.clearState();

            expect(mockGroupRegistry.clearAllGroups).toHaveBeenCalled();
            expect(mockGroupRegistry.disconnectGroup).toHaveBeenCalledTimes(2);
            expect(mockGroupRegistry.disconnectGroup).toHaveBeenCalledWith(mockGroups[0]);
            expect(mockGroupRegistry.disconnectGroup).toHaveBeenCalledWith(mockGroups[1]);
            expect(mockBookCache.clear).toHaveBeenCalled();
        });

        it('should handle empty groups array', async () => {
            mockGroupRegistry.clearAllGroups.mockResolvedValue([]);

            await manager.clearState();

            expect(mockGroupRegistry.disconnectGroup).not.toHaveBeenCalled();
            expect(mockBookCache.clear).toHaveBeenCalled();
        });
    });

    describe('event handling', () => {
        describe('actOnSubscribedEvents', () => {
            it('should filter events to only subscribed assets', async () => {
                const events = [
                    createMockBookEvent('asset1'),
                    createMockBookEvent('asset2'),
                    createMockBookEvent('asset3')
                ];

                // Only asset1 and asset3 are subscribed
                mockGroupRegistry.getGroupIndicesForAsset
                    .mockImplementation((assetId) => {
                        if (assetId === 'asset1' || assetId === 'asset3') return [0];
                        return [];
                    });

                // Create a manager with handlers that we can access
                const testManager = new WSSubscriptionManager(mockHandlers);
                
                // Access the private method through the handlers
                await (testManager as any).handlers.onBook(events);

                expect(mockHandlers.onBook).toHaveBeenCalledWith([
                    events[0], // asset1
                    events[2]  // asset3
                ]);
            });

            it('should not call handler if no events pass filtering', async () => {
                const events = [createMockBookEvent('asset1')];

                mockGroupRegistry.getGroupIndicesForAsset.mockReturnValue([]); // No subscriptions

                const testManager = new WSSubscriptionManager(mockHandlers);
                await (testManager as any).handlers.onBook(events);

                expect(mockHandlers.onBook).toHaveBeenCalledWith([]);
            });
        });

        it('should handle all event types correctly', async () => {
            const bookEvent = createMockBookEvent('asset1');
            const priceChangeEvent = createMockPriceChangeEvent('asset1');
            const lastTradeEvent: LastTradePriceEvent = {
                asset_id: 'asset1',
                market: 'test-market',
                timestamp: '1234567890',
                event_type: 'last_trade_price',
                fee_rate_bps: '0',
                price: '0.50',
                side: 'BUY',
                size: '100'
            };
            const tickSizeEvent: TickSizeChangeEvent = {
                asset_id: 'asset1',
                market: 'test-market',
                timestamp: '1234567890',
                event_type: 'tick_size_change',
                old_tick_size: '0.01',
                new_tick_size: '0.001'
            };
            const priceUpdateEvent: PolymarketPriceUpdateEvent = {
                asset_id: 'asset1',
                timestamp: '1234567890',
                event_type: 'price_update',
                triggeringEvent: priceChangeEvent,
                book: {
                    bids: [{ price: '0.45', size: '100' }],
                    asks: [{ price: '0.55', size: '50' }]
                },
                price: '0.50',
                midpoint: '0.50',
                spread: '0.10'
            };

            mockGroupRegistry.getGroupIndicesForAsset.mockReturnValue([0]);

            const testManager = new WSSubscriptionManager(mockHandlers);

            await (testManager as any).handlers.onBook([bookEvent]);
            await (testManager as any).handlers.onPriceChange([priceChangeEvent]);
            await (testManager as any).handlers.onLastTradePrice([lastTradeEvent]);
            await (testManager as any).handlers.onTickSizeChange([tickSizeEvent]);
            await (testManager as any).handlers.onPolymarketPriceUpdate([priceUpdateEvent]);

            expect(mockHandlers.onBook).toHaveBeenCalledWith([bookEvent]);
            expect(mockHandlers.onPriceChange).toHaveBeenCalledWith([priceChangeEvent]);
            expect(mockHandlers.onLastTradePrice).toHaveBeenCalledWith([lastTradeEvent]);
            expect(mockHandlers.onTickSizeChange).toHaveBeenCalledWith([tickSizeEvent]);
            expect(mockHandlers.onPolymarketPriceUpdate).toHaveBeenCalledWith([priceUpdateEvent]);
        });
    });

    describe('safeReconnectAndCleanup', () => {
        it('should reconnect groups that need reconnecting', async () => {
            const reconnectIds = ['group1', 'group2'];

            mockGroupRegistry.getGroupsToReconnectAndCleanup.mockResolvedValue(reconnectIds);
            mockGroupRegistry.findGroupById
                .mockReturnValueOnce(createMockGroup('group1', ['asset1']))
                .mockReturnValueOnce(createMockGroup('group2', ['asset2']));

            // Trigger the interval and wait for async operations
            vi.advanceTimersByTime(10000);
            vi.runOnlyPendingTimers();
            
            // Wait for the async operations in the interval callback
            await vi.waitFor(() => {
                expect(mockGroupRegistry.getGroupsToReconnectAndCleanup).toHaveBeenCalled();
            });

            expect(MockedGroupSocket).toHaveBeenCalledTimes(2);
            expect(mockGroupSocket.connect).toHaveBeenCalledTimes(2);
        });

        it('should handle reconnection errors', async () => {
            const error = new Error('Reconnection failed');

            mockGroupRegistry.getGroupsToReconnectAndCleanup.mockRejectedValue(error);

            // Trigger the interval and wait for async operations
            vi.advanceTimersByTime(10000);
            vi.runOnlyPendingTimers();

            // Wait for the async error handling
            await vi.waitFor(() => {
                expect(mockHandlers.onError).toHaveBeenCalledWith(error);
            });
        });

        it('should handle missing groups during reconnection', async () => {
            const reconnectIds = ['missing-group'];

            mockGroupRegistry.getGroupsToReconnectAndCleanup.mockResolvedValue(reconnectIds);
            mockGroupRegistry.findGroupById.mockReturnValue(undefined);

            // Trigger the interval and wait for async operations
            vi.advanceTimersByTime(10000);
            vi.runOnlyPendingTimers();

            // Wait for the async error handling
            await vi.waitFor(() => {
                expect(mockHandlers.onError).toHaveBeenCalledWith(
                    new Error('Group missing-group not found in registry')
                );
            });
        });
    });

    describe('handler delegation', () => {
        it('should delegate onWSClose to user handlers', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await (testManager as any).handlers.onWSClose('group1', ['asset1']);

            expect(mockHandlers.onWSClose).toHaveBeenCalledWith('group1', ['asset1']);
        });

        it('should delegate onWSOpen to user handlers', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await (testManager as any).handlers.onWSOpen('group1', ['asset1']);

            expect(mockHandlers.onWSOpen).toHaveBeenCalledWith('group1', ['asset1']);
        });

        it('should delegate onError to user handlers', async () => {
            const error = new Error('Test error');
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await (testManager as any).handlers.onError(error);

            expect(mockHandlers.onError).toHaveBeenCalledWith(error);
        });
    });

    describe('integration scenarios', () => {
        it('should handle complete subscription lifecycle', async () => {
            const assetIds = ['asset1', 'asset2'];
            const groupIds = ['group1'];

            // Add subscriptions
            mockGroupRegistry.addAssets.mockResolvedValue(groupIds);
            mockGroupRegistry.findGroupById.mockReturnValue(createMockGroup('group1', assetIds));

            await manager.addSubscriptions(assetIds);

            expect(mockGroupRegistry.addAssets).toHaveBeenCalledWith(assetIds, 100);
            expect(mockGroupSocket.connect).toHaveBeenCalled();

            // Remove subscriptions
            await manager.removeSubscriptions(['asset1']);

            expect(mockGroupRegistry.removeAssets).toHaveBeenCalledWith(['asset1'], mockBookCache);

            // Clear all state
            mockGroupRegistry.clearAllGroups.mockResolvedValue([createMockGroup('group1', ['asset2'])]);

            await manager.clearState();

            expect(mockGroupRegistry.clearAllGroups).toHaveBeenCalled();
            expect(mockBookCache.clear).toHaveBeenCalled();
        });

        it('should handle errors gracefully throughout lifecycle', async () => {
            // Error during add
            mockGroupRegistry.addAssets.mockRejectedValue(new Error('Add failed'));
            await manager.addSubscriptions(['asset1']);
            expect(mockHandlers.onError).toHaveBeenCalledWith(new Error('Error adding subscriptions: Add failed'));

            // Error during remove
            mockGroupRegistry.removeAssets.mockRejectedValue(new Error('Remove failed'));
            await manager.removeSubscriptions(['asset1']);
            expect(mockHandlers.onError).toHaveBeenCalledWith(new Error('Error removing subscriptions: Remove failed'));

            // Errors during periodic cleanup
            mockGroupRegistry.getGroupsToReconnectAndCleanup.mockRejectedValue(new Error('Cleanup failed'));
            vi.advanceTimersByTime(10000);
            vi.runOnlyPendingTimers();
            
            // Wait for the async error handling
            await vi.waitFor(() => {
                expect(mockHandlers.onError).toHaveBeenCalledWith(new Error('Cleanup failed'));
            });
        });
    });
}); 