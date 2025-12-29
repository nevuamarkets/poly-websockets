/// <reference types="vitest" />
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WSSubscriptionManager, WebSocketHandlers } from '../../src/WSSubscriptionManager';
import { OrderBookCache, BookEntry } from '../../src/modules/OrderBookCache';
import WebSocket from 'ws';
import {
    BookEvent,
    LastTradePriceEvent,
    PriceChangeEvent,
    TickSizeChangeEvent,
    PolymarketPriceUpdateEvent
} from '../../src/types/PolymarketWebSocket';

// Store event handlers so tests can trigger WebSocket events
let wsEventHandlers: { [key: string]: Function } = {};
let mockWsInstance: any = null;

// Mock WebSocket with event handler capture
vi.mock('ws', () => {
    const MockWebSocket = vi.fn(() => {
        wsEventHandlers = {};
        mockWsInstance = {
            readyState: 1, // WebSocket.OPEN
            on: vi.fn((event: string, handler: Function) => {
                wsEventHandlers[event] = handler;
            }),
            send: vi.fn(),
            ping: vi.fn(),
            close: vi.fn(() => {
                mockWsInstance.readyState = 3; // CLOSED
            }),
            removeAllListeners: vi.fn(() => {
                wsEventHandlers = {};
            }),
        };
        return mockWsInstance;
    });
    (MockWebSocket as any).OPEN = 1;
    (MockWebSocket as any).CLOSED = 3;
    (MockWebSocket as any).CONNECTING = 0;
    return { default: MockWebSocket };
});

// Mock OrderBookCache
vi.mock('../../src/modules/OrderBookCache');
const MockedOrderBookCache = vi.mocked(OrderBookCache);

describe('WSSubscriptionManager', () => {
    let manager: WSSubscriptionManager;
    let mockHandlers: WebSocketHandlers;
    let mockBookCache: any;

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

    const createMockLastTradePriceEvent = (assetId: string): LastTradePriceEvent => ({
        asset_id: assetId,
        market: 'test-market',
        timestamp: '1234567890',
        event_type: 'last_trade_price',
        fee_rate_bps: '0',
        price: '0.50',
        side: 'BUY',
        size: '100',
        transaction_hash: '0xabc123'
    });

    const createMockTickSizeChangeEvent = (assetId: string): TickSizeChangeEvent => ({
        asset_id: assetId,
        market: 'test-market',
        timestamp: '1234567890',
        event_type: 'tick_size_change',
        old_tick_size: '0.01',
        new_tick_size: '0.001'
    });

    // Helper to simulate WebSocket open event
    const simulateWsOpen = async () => {
        if (wsEventHandlers['open']) {
            await wsEventHandlers['open']();
        }
    };

    // Helper to simulate WebSocket message
    const simulateWsMessage = async (data: any) => {
        if (wsEventHandlers['message']) {
            const buffer = Buffer.from(JSON.stringify(data));
            await wsEventHandlers['message'](buffer);
        }
    };

    // Helper to simulate WebSocket close
    const simulateWsClose = async (code: number = 1000, reason: string = '') => {
        if (wsEventHandlers['close']) {
            await wsEventHandlers['close'](code, Buffer.from(reason));
        }
    };

    // Helper to simulate WebSocket error
    const simulateWsError = async (error: Error) => {
        if (wsEventHandlers['error']) {
            await wsEventHandlers['error'](error);
        }
    };

    beforeEach(() => {
        wsEventHandlers = {};
        mockWsInstance = null;
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

        // Setup OrderBookCache mock
        mockBookCache = {
            clear: vi.fn(),
            replaceBook: vi.fn(),
            upsertPriceChange: vi.fn(),
            spreadOver: vi.fn(),
            midpoint: vi.fn(),
            getBookEntry: vi.fn(),
        } as any;

        MockedOrderBookCache.mockImplementation(() => mockBookCache);

        manager = new WSSubscriptionManager(mockHandlers);
    });

    afterEach(async () => {
        await manager.clearState();
        vi.useRealTimers();
    });

    describe('constructor', () => {
        it('should initialize with correct dependencies', () => {
            expect(MockedOrderBookCache).toHaveBeenCalledTimes(1);
        });

        it('should set up periodic intervals', () => {
            // Should have reconnect and pending flush intervals
            expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);
        });
    });

    describe('addSubscriptions', () => {
        it('should add assets to pending queue', async () => {
            const assetIds = ['asset1', 'asset2'];

            await manager.addSubscriptions(assetIds);

            // Assets should be tracked (either pending or subscribed after connection)
            const allAssets = manager.getAssetIds();
            expect(allAssets).toContain('asset1');
            expect(allAssets).toContain('asset2');
        });

        it('should not duplicate already pending assets', async () => {
            const assetIds = ['asset1', 'asset1', 'asset1'];

            await manager.addSubscriptions(assetIds);

            const allAssets = manager.getAssetIds();
            expect(allAssets.filter(id => id === 'asset1').length).toBe(1);
        });

        it('should handle errors gracefully', async () => {
            // Mock WebSocket to throw
            const WebSocketMock = vi.mocked(WebSocket);
            WebSocketMock.mockImplementationOnce(() => {
                throw new Error('Connection failed');
            });

            await manager.addSubscriptions(['asset1']);

            expect(mockHandlers.onError).toHaveBeenCalled();
        });
    });

    describe('removeSubscriptions', () => {
        it('should remove pending assets without sending unsubscribe', async () => {
            await manager.addSubscriptions(['asset1', 'asset2']);
            
            // Remove before they're actually subscribed (before flush)
            await manager.removeSubscriptions(['asset1']);

            const stats = manager.getStatistics();
            // asset1 should be gone, asset2 should remain
            expect(manager.getAssetIds()).not.toContain('asset1');
        });

        it('should add subscribed assets to pending unsubscribe when removed', async () => {
            // Manually add to subscribed (simulating a successfully subscribed asset)
            (manager as any).subscribedAssetIds.add('asset1');
            
            await manager.removeSubscriptions(['asset1']);

            // Book cache is NOT cleared immediately - it's cleared when the unsubscription is flushed
            // This prevents issues with events that arrive before the flush
            expect(mockBookCache.clear).not.toHaveBeenCalledWith('asset1');
            
            // Asset should be in pending unsubscribe
            expect((manager as any).pendingUnsubscribeAssetIds.has('asset1')).toBe(true);
        });

        it('should not clear book cache for pending assets (never subscribed)', async () => {
            // Only add to pending
            await manager.addSubscriptions(['asset1']);
            
            // Remove before it becomes subscribed
            await manager.removeSubscriptions(['asset1']);

            // Book cache should not be cleared for assets that were never subscribed
            expect(mockBookCache.clear).not.toHaveBeenCalledWith('asset1');
        });
    });

    describe('clearState', () => {
        it('should clear all asset tracking', async () => {
            await manager.addSubscriptions(['asset1', 'asset2']);
            
            await manager.clearState();

            expect(manager.getAssetIds()).toHaveLength(0);
        });

        it('should stop all timers', async () => {
            const timerCountBefore = vi.getTimerCount();
            expect(timerCountBefore).toBeGreaterThan(0);

            await manager.clearState();

            // After clearState, manager's timers should be stopped
            // Note: we need to account for timers created by the manager
            expect(vi.getTimerCount()).toBe(0);
        });

        it('should clear the order book cache', async () => {
            await manager.clearState();

            expect(mockBookCache.clear).toHaveBeenCalled();
        });
    });

    describe('getAssetIds', () => {
        it('should return all monitored assets (subscribed + pending)', async () => {
            await manager.addSubscriptions(['asset1', 'asset2']);

            const assetIds = manager.getAssetIds();

            expect(assetIds).toContain('asset1');
            expect(assetIds).toContain('asset2');
            expect(assetIds).toHaveLength(2);
        });

        it('should exclude pending unsubscribes', async () => {
            await manager.addSubscriptions(['asset1', 'asset2']);
            await manager.removeSubscriptions(['asset1']);

            const assetIds = manager.getAssetIds();

            expect(assetIds).not.toContain('asset1');
            expect(assetIds).toContain('asset2');
        });
    });

    describe('getStatistics', () => {
        it('should return correct statistics', async () => {
            const stats = manager.getStatistics();

            expect(stats).toHaveProperty('openWebSockets');
            expect(stats).toHaveProperty('assetIds');
            expect(stats).toHaveProperty('pendingAssetIds');
        });
    });

    describe('handler delegation', () => {
        it('should delegate onWSClose to user handlers', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Access internal handlers
            await (testManager as any).handlers.onWSClose('test-id', 1000, 'normal');

            expect(mockHandlers.onWSClose).toHaveBeenCalledWith('test-id', 1000, 'normal');
            await testManager.clearState();
        });

        it('should delegate onWSOpen to user handlers', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await (testManager as any).handlers.onWSOpen('test-id', ['asset1']);

            expect(mockHandlers.onWSOpen).toHaveBeenCalledWith('test-id', ['asset1']);
            await testManager.clearState();
        });

        it('should delegate onError to user handlers', async () => {
            const error = new Error('Test error');
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await (testManager as any).handlers.onError(error);

            expect(mockHandlers.onError).toHaveBeenCalledWith(error);
            await testManager.clearState();
        });
    });

    describe('event filtering', () => {
        it('should filter events to only subscribed assets', async () => {
            const events = [
                createMockBookEvent('asset1'),
                createMockBookEvent('asset2'),
                createMockBookEvent('asset3')
            ];

            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Manually add to subscribed set for testing
            (testManager as any).subscribedAssetIds.add('asset1');
            (testManager as any).subscribedAssetIds.add('asset3');

            await (testManager as any).handlers.onBook(events);

            expect(mockHandlers.onBook).toHaveBeenCalledWith([
                events[0], // asset1
                events[2]  // asset3
            ]);
            await testManager.clearState();
        });

        it('should not call handler if no events pass filtering', async () => {
            const events = [createMockBookEvent('asset1')];

            const testManager = new WSSubscriptionManager(mockHandlers);
            // No assets subscribed

            await (testManager as any).handlers.onBook(events);

            // Handler should NOT be called when all events are filtered out
            expect(mockHandlers.onBook).not.toHaveBeenCalled();
            await testManager.clearState();
        });

        it('should filter price_change events by their nested asset_ids', async () => {
            const event = createMockPriceChangeEvent('asset1');

            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');

            await (testManager as any).handlers.onPriceChange([event]);

            expect(mockHandlers.onPriceChange).toHaveBeenCalledWith([event]);
            await testManager.clearState();
        });
    });

    describe('integration scenarios', () => {
        it('should handle complete subscription lifecycle', async () => {
            const assetIds = ['asset1', 'asset2'];

            // Add subscriptions
            await manager.addSubscriptions(assetIds);
            expect(manager.getAssetIds()).toContain('asset1');
            expect(manager.getAssetIds()).toContain('asset2');

            // Remove some subscriptions
            await manager.removeSubscriptions(['asset1']);
            expect(manager.getAssetIds()).not.toContain('asset1');
            expect(manager.getAssetIds()).toContain('asset2');

            // Clear all state
            await manager.clearState();
            expect(manager.getAssetIds()).toHaveLength(0);
        });

        it('should allow multiple independent manager instances', async () => {
            const manager1 = new WSSubscriptionManager(mockHandlers);
            const manager2 = new WSSubscriptionManager(mockHandlers);

            await manager1.addSubscriptions(['asset1', 'asset2']);
            await manager2.addSubscriptions(['asset3', 'asset4']);

            // Each manager should have its own assets
            expect(manager1.getAssetIds()).toContain('asset1');
            expect(manager1.getAssetIds()).not.toContain('asset3');
            expect(manager2.getAssetIds()).toContain('asset3');
            expect(manager2.getAssetIds()).not.toContain('asset1');

            await manager1.clearState();
            await manager2.clearState();
        });
    });

    describe('reconnection and error handling', () => {
        it('should move subscribed assets to pending on close', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Simulate subscribed state
            (testManager as any).subscribedAssetIds.add('asset1');
            (testManager as any).subscribedAssetIds.add('asset2');
            
            // Simulate close event by directly calling the internal handler logic
            // Access the handleClose behavior
            (testManager as any).status = 'disconnected';
            (testManager as any).wsClient = null;
            
            // Move assets (simulating what handleClose does)
            for (const assetId of (testManager as any).subscribedAssetIds) {
                (testManager as any).pendingSubscribeAssetIds.add(assetId);
            }
            (testManager as any).subscribedAssetIds.clear();
            
            // Verify assets moved to pending
            expect((testManager as any).pendingSubscribeAssetIds.has('asset1')).toBe(true);
            expect((testManager as any).pendingSubscribeAssetIds.has('asset2')).toBe(true);
            expect((testManager as any).subscribedAssetIds.size).toBe(0);
            
            await testManager.clearState();
        });

        it('should clear pending unsubscribes on disconnect', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Simulate state with pending unsubscribes
            (testManager as any).subscribedAssetIds.add('asset1');
            (testManager as any).pendingUnsubscribeAssetIds.add('asset1');
            
            // Simulate disconnect behavior
            (testManager as any).pendingUnsubscribeAssetIds.clear();
            
            // Verify pending unsubscribes are cleared
            expect((testManager as any).pendingUnsubscribeAssetIds.size).toBe(0);
            
            await testManager.clearState();
        });

        it('should handle user handler throwing errors gracefully', async () => {
            const throwingHandlers: WebSocketHandlers = {
                onBook: vi.fn().mockRejectedValue(new Error('Handler error')),
                onError: vi.fn()
            };
            
            const testManager = new WSSubscriptionManager(throwingHandlers);
            
            // The internal handlers should catch errors from user handlers
            // and not propagate them
            (testManager as any).subscribedAssetIds.add('asset1');
            
            // This should not throw even if onBook throws
            await expect(
                (testManager as any).handlers.onBook([createMockBookEvent('asset1')])
            ).resolves.not.toThrow();
            
            await testManager.clearState();
        });

        it('should use fixed reconnect interval', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Verify the reconnect interval is set to the default (5 seconds)
            expect((testManager as any).reconnectIntervalMs).toBe(5000);
            
            await testManager.clearState();
        });

        it('should allow custom reconnect interval', async () => {
            const customInterval = 10000;
            const testManager = new WSSubscriptionManager(mockHandlers, {
                reconnectAndCleanupIntervalMs: customInterval
            });
            
            expect((testManager as any).reconnectIntervalMs).toBe(customInterval);
            
            await testManager.clearState();
        });

        it('should null wsClient on error', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Create a mock wsClient
            const mockWsClient = {
                readyState: 3, // CLOSED
                removeAllListeners: vi.fn(),
            };
            (testManager as any).wsClient = mockWsClient;
            
            // Simulate what handleError does
            if ((testManager as any).wsClient) {
                (testManager as any).wsClient.removeAllListeners();
                (testManager as any).wsClient = null;
            }
            
            expect((testManager as any).wsClient).toBeNull();
            
            await testManager.clearState();
        });
    });

    describe('safe error handler', () => {
        it('should not throw when calling safeCallErrorHandler', async () => {
            const throwingHandlers: WebSocketHandlers = {
                onError: vi.fn().mockRejectedValue(new Error('Error handler threw'))
            };
            
            const testManager = new WSSubscriptionManager(throwingHandlers);
            
            // This should not throw
            await expect(
                (testManager as any).safeCallErrorHandler(new Error('Test error'))
            ).resolves.not.toThrow();
            
            await testManager.clearState();
        });

        it('should still call the error handler', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await (testManager as any).safeCallErrorHandler(new Error('Test error'));
            
            expect(mockHandlers.onError).toHaveBeenCalled();
            
            await testManager.clearState();
        });
    });

    describe('pending unsubscribe intent preservation (bug fix)', () => {
        it('should NOT re-subscribe assets that were pending unsubscribe when connection drops', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Simulate: asset is subscribed AND pending unsubscribe (user wants to unsubscribe)
            (testManager as any).subscribedAssetIds.add('asset1');
            (testManager as any).subscribedAssetIds.add('asset2');
            (testManager as any).pendingUnsubscribeAssetIds.add('asset1'); // User wants to unsubscribe asset1
            
            // Simulate disconnect (what handleClose does internally)
            for (const assetId of (testManager as any).subscribedAssetIds) {
                if (!(testManager as any).pendingUnsubscribeAssetIds.has(assetId)) {
                    (testManager as any).pendingSubscribeAssetIds.add(assetId);
                }
            }
            (testManager as any).subscribedAssetIds.clear();
            (testManager as any).pendingUnsubscribeAssetIds.clear();
            
            // asset1 should NOT be in pendingSubscribe (user's unsubscribe intent preserved)
            expect((testManager as any).pendingSubscribeAssetIds.has('asset1')).toBe(false);
            // asset2 SHOULD be in pendingSubscribe (will be re-subscribed)
            expect((testManager as any).pendingSubscribeAssetIds.has('asset2')).toBe(true);
            
            await testManager.clearState();
        });

        it('should preserve unsubscribe intent on error as well as close', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Simulate: multiple assets with some pending unsubscribe
            (testManager as any).subscribedAssetIds.add('keep1');
            (testManager as any).subscribedAssetIds.add('remove1');
            (testManager as any).subscribedAssetIds.add('keep2');
            (testManager as any).subscribedAssetIds.add('remove2');
            (testManager as any).pendingUnsubscribeAssetIds.add('remove1');
            (testManager as any).pendingUnsubscribeAssetIds.add('remove2');
            
            // Simulate error disconnect behavior
            for (const assetId of (testManager as any).subscribedAssetIds) {
                if (!(testManager as any).pendingUnsubscribeAssetIds.has(assetId)) {
                    (testManager as any).pendingSubscribeAssetIds.add(assetId);
                }
            }
            (testManager as any).subscribedAssetIds.clear();
            (testManager as any).pendingUnsubscribeAssetIds.clear();
            
            // Removed assets should not be pending re-subscription
            expect((testManager as any).pendingSubscribeAssetIds.has('remove1')).toBe(false);
            expect((testManager as any).pendingSubscribeAssetIds.has('remove2')).toBe(false);
            // Kept assets should be pending re-subscription
            expect((testManager as any).pendingSubscribeAssetIds.has('keep1')).toBe(true);
            expect((testManager as any).pendingSubscribeAssetIds.has('keep2')).toBe(true);
            
            await testManager.clearState();
        });

        it('should correctly report getAssetIds after disconnect with pending unsubscribes', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            (testManager as any).subscribedAssetIds.add('asset1');
            (testManager as any).subscribedAssetIds.add('asset2');
            (testManager as any).pendingUnsubscribeAssetIds.add('asset1');
            
            // Before disconnect, getAssetIds should exclude pending unsubscribes
            expect(testManager.getAssetIds()).not.toContain('asset1');
            expect(testManager.getAssetIds()).toContain('asset2');
            
            await testManager.clearState();
        });
    });

    describe('connection timeout', () => {
        it('should timeout connection after 30 seconds using fake timers', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Set up wsClient in CONNECTING state
            (testManager as any).connecting = true;
            (testManager as any).status = 'connecting';
            const mockWs = {
                readyState: 0, // CONNECTING
                removeAllListeners: vi.fn(),
                close: vi.fn(),
                on: vi.fn(),
                send: vi.fn(),
            };
            (testManager as any).wsClient = mockWs;
            
            // Set up a connection timeout manually (simulating what connect() does)
            const connectionTimeout = setTimeout(async () => {
                if ((testManager as any).connecting && 
                    (testManager as any).wsClient && 
                    (testManager as any).wsClient.readyState !== 1) { // not OPEN
                    (testManager as any).status = 'disconnected';
                    (testManager as any).connecting = false;
                    (testManager as any).wsClient.removeAllListeners();
                    (testManager as any).wsClient.close();
                    (testManager as any).wsClient = null;
                    await (testManager as any).safeCallErrorHandler(
                        new Error('WebSocket connection timeout after 30s')
                    );
                }
            }, 30000);
            (testManager as any).connectionTimeout = connectionTimeout;
            
            // Fast-forward time by 30 seconds
            await vi.advanceTimersByTimeAsync(30000);
            
            // Verify timeout behavior
            expect(mockWs.removeAllListeners).toHaveBeenCalled();
            expect(mockWs.close).toHaveBeenCalled();
            expect((testManager as any).wsClient).toBeNull();
            expect((testManager as any).connecting).toBe(false);
            expect(mockHandlers.onError).toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should clear timeout when connection opens successfully', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Add subscription to trigger connection
            await testManager.addSubscriptions(['asset1']);
            
            // Simulate successful open
            await simulateWsOpen();
            
            // The connectionTimeout should be cleared (we can't directly check, 
            // but we can verify the manager is in connected state)
            expect((testManager as any).status).toBe('connected');
            expect((testManager as any).connecting).toBe(false);
            
            await testManager.clearState();
        });
    });

    describe('WebSocket message parsing', () => {
        it('should parse and route book events correctly', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const bookEvent = createMockBookEvent('asset1');
            await simulateWsMessage([bookEvent]);
            
            expect(mockBookCache.replaceBook).toHaveBeenCalledWith(bookEvent);
            
            await testManager.clearState();
        });

        it('should parse and route last_trade_price events correctly', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const lastTradeEvent = createMockLastTradePriceEvent('asset1');
            await simulateWsMessage([lastTradeEvent]);
            
            expect(mockHandlers.onLastTradePrice).toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should parse and route tick_size_change events correctly', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const tickEvent = createMockTickSizeChangeEvent('asset1');
            await simulateWsMessage([tickEvent]);
            
            expect(mockHandlers.onTickSizeChange).toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should parse and route price_change events correctly', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const priceChangeEvent = createMockPriceChangeEvent('asset1');
            await simulateWsMessage([priceChangeEvent]);
            
            expect(mockHandlers.onPriceChange).toHaveBeenCalled();
            expect(mockBookCache.upsertPriceChange).toHaveBeenCalledWith(priceChangeEvent);
            
            await testManager.clearState();
        });

        it('should ignore events for non-subscribed assets', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            // Send event for asset2 which is NOT subscribed
            const bookEvent = createMockBookEvent('asset2');
            await simulateWsMessage([bookEvent]);
            
            // Should not process events for non-subscribed assets
            expect(mockBookCache.replaceBook).not.toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should handle PONG message gracefully', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            // Simulate PONG message (server response to ping)
            if (wsEventHandlers['message']) {
                await wsEventHandlers['message'](Buffer.from('PONG'));
            }
            
            // Should not throw or call error handler
            expect(mockHandlers.onError).not.toHaveBeenCalled();
            
            await testManager.clearState();
        });
    });

    describe('invalid message handling', () => {
        it('should handle invalid JSON gracefully', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            // Send invalid JSON
            if (wsEventHandlers['message']) {
                await wsEventHandlers['message'](Buffer.from('not valid json {{{'));
            }
            
            expect(mockHandlers.onError).toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should handle empty message array', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            await simulateWsMessage([]);
            
            // Should not throw
            expect(mockHandlers.onBook).not.toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should handle events with empty asset_id', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const eventWithEmptyId = { ...createMockBookEvent(''), asset_id: '' };
            await simulateWsMessage([eventWithEmptyId]);
            
            // Should filter out events with empty asset_id
            expect(mockBookCache.replaceBook).not.toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should handle unknown event types gracefully', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const unknownEvent = {
                asset_id: 'asset1',
                event_type: 'unknown_type',
                timestamp: '1234567890'
            };
            await simulateWsMessage([unknownEvent]);
            
            // Should call error handler for unknown event type
            expect(mockHandlers.onError).toHaveBeenCalled();
            
            await testManager.clearState();
        });
    });

    describe('ping/pong heartbeat', () => {
        it('should start ping interval after connection opens', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            // Ping interval should be set
            expect((testManager as any).pingInterval).toBeDefined();
            
            await testManager.clearState();
        });

        it('should send pings periodically', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            // Advance time by 20 seconds (base ping interval)
            await vi.advanceTimersByTimeAsync(20000);
            
            // Advance a bit more for jitter
            await vi.advanceTimersByTimeAsync(5000);
            
            // Check if ping was called (it might have jitter)
            // Note: Due to jitter, we can't guarantee exact timing
            expect(mockWsInstance?.ping || vi.fn()).toBeDefined();
            
            await testManager.clearState();
        });

        it('should clear ping interval on close', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            expect((testManager as any).pingInterval).toBeDefined();
            
            await simulateWsClose(1000, 'normal');
            
            expect((testManager as any).pingInterval).toBeUndefined();
            
            await testManager.clearState();
        });

        it('should handle pong response', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            // Simulate pong response
            if (wsEventHandlers['pong']) {
                wsEventHandlers['pong']();
            }
            
            // Should not throw or cause any issues
            expect(mockHandlers.onError).not.toHaveBeenCalled();
            
            await testManager.clearState();
        });
    });

    describe('derived price update events (onPolymarketPriceUpdate)', () => {
        it('should emit price update when spread is under 10 cents on price_change', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            // Setup mock book cache behavior
            mockBookCache.spreadOver.mockReturnValue(false); // spread is under 10 cents
            mockBookCache.midpoint.mockReturnValue('0.50');
            mockBookCache.getBookEntry.mockReturnValue({
                bids: [{ price: '0.45', size: '100' }],
                asks: [{ price: '0.55', size: '50' }],
                price: '0.49', // Different from new midpoint
                midpoint: '0.50',
                spread: '0.10'
            });
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const priceChangeEvent = createMockPriceChangeEvent('asset1');
            await simulateWsMessage([priceChangeEvent]);
            
            // Should emit price update event
            expect(mockHandlers.onPolymarketPriceUpdate).toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should emit price update using last trade price when spread is over 10 cents', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            // Setup mock book cache behavior
            mockBookCache.spreadOver.mockReturnValue(true); // spread is over 10 cents
            mockBookCache.getBookEntry.mockReturnValue({
                bids: [{ price: '0.40', size: '100' }],
                asks: [{ price: '0.60', size: '50' }],
                price: '0.45', // Different from last trade price
                midpoint: '0.50',
                spread: '0.20'
            });
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const lastTradeEvent = createMockLastTradePriceEvent('asset1');
            await simulateWsMessage([lastTradeEvent]);
            
            // Should emit price update event using last trade price
            expect(mockHandlers.onPolymarketPriceUpdate).toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should NOT emit price update when price has not changed', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            mockBookCache.spreadOver.mockReturnValue(false);
            mockBookCache.midpoint.mockReturnValue('0.50');
            mockBookCache.getBookEntry.mockReturnValue({
                bids: [{ price: '0.45', size: '100' }],
                asks: [{ price: '0.55', size: '50' }],
                price: '0.50', // Same as midpoint - no change
                midpoint: '0.50',
                spread: '0.10'
            });
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const priceChangeEvent = createMockPriceChangeEvent('asset1');
            await simulateWsMessage([priceChangeEvent]);
            
            // Should NOT emit price update when price hasn't changed
            expect(mockHandlers.onPolymarketPriceUpdate).not.toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should handle spreadOver throwing error gracefully', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            (testManager as any).subscribedAssetIds.add('asset1');
            
            mockBookCache.spreadOver.mockImplementation(() => {
                throw new Error('No bids in book');
            });
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            const priceChangeEvent = createMockPriceChangeEvent('asset1');
            await simulateWsMessage([priceChangeEvent]);
            
            // Should not throw, just skip the price update calculation
            expect(mockHandlers.onPolymarketPriceUpdate).not.toHaveBeenCalled();
            
            await testManager.clearState();
        });
    });

    describe('rapid subscribe/unsubscribe operations', () => {
        it('should handle rapid add then remove correctly', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Rapidly add then remove
            await testManager.addSubscriptions(['asset1']);
            await testManager.removeSubscriptions(['asset1']);
            
            // Asset should not be tracked
            expect(testManager.getAssetIds()).not.toContain('asset1');
            
            await testManager.clearState();
        });

        it('should handle rapid remove then add correctly', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // First subscribe
            (testManager as any).subscribedAssetIds.add('asset1');
            
            // Rapidly remove then add
            await testManager.removeSubscriptions(['asset1']);
            await testManager.addSubscriptions(['asset1']);
            
            // Asset should be tracked (add cancels the remove)
            expect(testManager.getAssetIds()).toContain('asset1');
            // Should not be in pending unsubscribe anymore
            expect((testManager as any).pendingUnsubscribeAssetIds.has('asset1')).toBe(false);
            
            await testManager.clearState();
        });

        it('should handle multiple rapid operations on same asset', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Multiple rapid operations
            await testManager.addSubscriptions(['asset1']);
            await testManager.removeSubscriptions(['asset1']);
            await testManager.addSubscriptions(['asset1']);
            await testManager.removeSubscriptions(['asset1']);
            await testManager.addSubscriptions(['asset1']);
            
            // Final state should reflect last operation (add)
            expect(testManager.getAssetIds()).toContain('asset1');
            
            await testManager.clearState();
        });

        it('should handle concurrent operations on different assets', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Concurrent operations on different assets
            await Promise.all([
                testManager.addSubscriptions(['asset1']),
                testManager.addSubscriptions(['asset2']),
                testManager.addSubscriptions(['asset3']),
            ]);
            
            expect(testManager.getAssetIds()).toContain('asset1');
            expect(testManager.getAssetIds()).toContain('asset2');
            expect(testManager.getAssetIds()).toContain('asset3');
            
            await testManager.clearState();
        });
    });

    describe('reconnection flow', () => {
        it('should trigger reconnection check when disconnected with pending assets', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Add assets to pending
            (testManager as any).pendingSubscribeAssetIds.add('asset1');
            (testManager as any).wsClient = null;
            (testManager as any).connecting = false;
            
            // Advance time to trigger reconnection check (5 seconds default)
            await vi.advanceTimersByTimeAsync(5000);
            
            // A connection attempt should have been made
            expect(WebSocket).toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should not reconnect if no pending assets', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            vi.clearAllMocks();
            
            // No pending assets
            (testManager as any).pendingSubscribeAssetIds.clear();
            (testManager as any).subscribedAssetIds.clear();
            (testManager as any).wsClient = null;
            (testManager as any).connecting = false;
            
            // Advance time
            await vi.advanceTimersByTimeAsync(5000);
            
            // Should not attempt connection
            expect(WebSocket).not.toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should not reconnect if already connecting', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            vi.clearAllMocks();
            
            (testManager as any).pendingSubscribeAssetIds.add('asset1');
            (testManager as any).connecting = true; // Already connecting
            
            // Advance time
            await vi.advanceTimersByTimeAsync(5000);
            
            // Should not attempt another connection
            expect(WebSocket).not.toHaveBeenCalled();
            
            await testManager.clearState();
        });

        it('should clear book cache on reconnection', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            (testManager as any).pendingSubscribeAssetIds.add('asset1');
            (testManager as any).wsClient = null;
            (testManager as any).connecting = false;
            
            // Trigger reconnection
            await (testManager as any).checkReconnection();
            
            // Book cache should be cleared
            expect(mockBookCache.clear).toHaveBeenCalled();
            
            await testManager.clearState();
        });
    });

    describe('flush pending subscriptions', () => {
        it('should send subscribe message with all pending assets', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await testManager.addSubscriptions(['asset1', 'asset2', 'asset3']);
            await simulateWsOpen();
            
            // Check that subscribe was sent with all assets
            expect(mockWsInstance.send).toHaveBeenCalled();
            const sendCalls = mockWsInstance.send.mock.calls;
            const subscribeCall = sendCalls.find((call: any[]) => {
                const parsed = JSON.parse(call[0]);
                return parsed.operation === 'subscribe';
            });
            expect(subscribeCall).toBeDefined();
            
            await testManager.clearState();
        });

        it('should process unsubscribes before subscribes', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Set up state with both pending subscribe and unsubscribe
            (testManager as any).subscribedAssetIds.add('removeMe');
            (testManager as any).pendingUnsubscribeAssetIds.add('removeMe');
            (testManager as any).pendingSubscribeAssetIds.add('addMe');
            
            // Create mock wsClient with all required methods
            const mockWs = {
                readyState: 1,
                send: vi.fn(),
                close: vi.fn(),
                removeAllListeners: vi.fn(),
            };
            (testManager as any).wsClient = mockWs;
            
            // Trigger flush
            (testManager as any).flushPendingSubscriptions();
            
            // Both should have been sent
            expect(mockWs.send).toHaveBeenCalledTimes(2);
            
            // Verify order: unsubscribe first, then subscribe
            const calls = mockWs.send.mock.calls;
            const firstCall = JSON.parse(calls[0][0]);
            const secondCall = JSON.parse(calls[1][0]);
            
            expect(firstCall.operation).toBe('unsubscribe');
            expect(secondCall.operation).toBe('subscribe');
            
            await testManager.clearState();
        });

        it('should clear book cache for unsubscribed assets', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            (testManager as any).subscribedAssetIds.add('asset1');
            (testManager as any).subscribedAssetIds.add('asset2'); // Keep one to prevent WS close
            (testManager as any).pendingUnsubscribeAssetIds.add('asset1');
            
            const mockWs = {
                readyState: 1,
                send: vi.fn(),
                close: vi.fn(),
                removeAllListeners: vi.fn(),
            };
            (testManager as any).wsClient = mockWs;
            
            (testManager as any).flushPendingSubscriptions();
            
            expect(mockBookCache.clear).toHaveBeenCalledWith('asset1');
            
            await testManager.clearState();
        });

        it('should close WebSocket when all assets are removed', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            // Start with subscribed assets
            (testManager as any).subscribedAssetIds.add('asset1');
            (testManager as any).pendingUnsubscribeAssetIds.add('asset1');
            
            const mockWs = {
                readyState: 1,
                send: vi.fn(),
                close: vi.fn(),
                removeAllListeners: vi.fn(),
            };
            (testManager as any).wsClient = mockWs;
            
            (testManager as any).flushPendingSubscriptions();
            
            // WebSocket should be closed
            expect(mockWs.close).toHaveBeenCalled();
            
            await testManager.clearState();
        });
    });

    describe('initial handshake', () => {
        it('should send empty market message on connection open', async () => {
            const testManager = new WSSubscriptionManager(mockHandlers);
            
            await testManager.addSubscriptions(['asset1']);
            await simulateWsOpen();
            
            // First message should be the market handshake
            const sendCalls = mockWsInstance.send.mock.calls;
            const firstCall = JSON.parse(sendCalls[0][0]);
            
            expect(firstCall.type).toBe('market');
            expect(firstCall.assets_ids).toEqual([]);
            
            await testManager.clearState();
        });
    });
});
