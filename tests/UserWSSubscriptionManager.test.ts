import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserWSSubscriptionManager } from '../src/UserWSSubscriptionManager';
import { UserWebSocketHandlers, ApiCredentials, OrderEvent, TradeEvent } from '../src/types/PolymarketWebSocket';
import { UserSubscriptionManagerOptions } from '../src/types/WebSocketSubscriptions';
import Bottleneck from 'bottleneck';

// Mock dependencies
vi.mock('../src/modules/UserGroupRegistry', () => ({
    UserGroupRegistry: vi.fn().mockImplementation(() => ({
        addMarkets: vi.fn().mockResolvedValue([]),
        removeMarkets: vi.fn().mockResolvedValue([]),
        clearAllGroups: vi.fn().mockResolvedValue([]),
        getGroupsToReconnectAndCleanup: vi.fn().mockResolvedValue([]),
        findGroupById: vi.fn().mockReturnValue(undefined),
        hasMarket: vi.fn().mockReturnValue(false)
    }))
}));

vi.mock('../src/modules/UserGroupSocket', () => ({
    UserGroupSocket: vi.fn().mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue(undefined)
    }))
}));

vi.mock('bottleneck', () => ({
    default: vi.fn().mockImplementation(() => ({
        schedule: vi.fn().mockResolvedValue(undefined),
        on: vi.fn()
    }))
}));

const MockedBottleneck = vi.mocked(Bottleneck);

describe('UserWSSubscriptionManager', () => {
    let mockHandlers: UserWebSocketHandlers;
    let mockAuth: ApiCredentials;
    let manager: UserWSSubscriptionManager;

    beforeEach(() => {
        vi.useFakeTimers();
        
        mockHandlers = {
            onOrder: vi.fn(),
            onTrade: vi.fn(),
            onError: vi.fn(),
            onWSClose: vi.fn(),
            onWSOpen: vi.fn()
        };

        mockAuth = {
            apiKey: 'test-api-key',
            secret: 'test-secret',
            passphrase: 'test-passphrase'
        };

        const options: UserSubscriptionManagerOptions = {
            auth: mockAuth,
            maxMarketsPerWS: 50,
            reconnectAndCleanupIntervalMs: 5000
        };

        manager = new UserWSSubscriptionManager(mockHandlers, options);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with correct dependencies and auth', () => {
            expect(MockedBottleneck).toHaveBeenCalledWith({
                reservoir: 5,
                reservoirRefreshAmount: 5,
                reservoirRefreshInterval: 1000,
                maxConcurrent: 5
            });
        });

        it('should use custom bottleneck if provided in options', () => {
            const customBottleneck = new Bottleneck();
            const options: UserSubscriptionManagerOptions = {
                auth: mockAuth,
                burstLimiter: customBottleneck
            };
            
            new UserWSSubscriptionManager(mockHandlers, options);
            
            // Should use provided bottleneck
            expect(MockedBottleneck).toHaveBeenCalledTimes(2); // 1 for first manager, 1 for custom one
        });
    });

    describe('subscription management', () => {
        it('should add subscriptions', async () => {
            const marketIds = ['market1', 'market2'];
            
            // This would trigger the internal logic
            await manager.addSubscriptions(marketIds);
            
            // Verify no errors were thrown
            expect(mockHandlers.onError).not.toHaveBeenCalled();
        });

        it('should remove subscriptions', async () => {
            const marketIds = ['market1'];
            
            await manager.removeSubscriptions(marketIds);
            
            // Verify no errors were thrown
            expect(mockHandlers.onError).not.toHaveBeenCalled();
        });

        it('should clear all state', async () => {
            await manager.clearState();
            
            // Verify no errors were thrown
            expect(mockHandlers.onError).not.toHaveBeenCalled();
        });
    });

    describe('event handling', () => {
        it('should handle order events', async () => {
            const orderEvent: OrderEvent = {
                event_type: 'order',
                id: 'order123',
                asset_id: 'asset123',
                market: 'market123',
                side: 'BUY',
                original_size: '100',
                price: '0.5',
                status: 'LIVE',
                timestamp: '1640000000000',
                associate_trades: null,
                created_at: '1640000000',
                expiration: '0',
                maker_address: '0x1234567890abcdef',
                order_owner: 'owner123',
                order_type: 'GTC',
                outcome: 'Yes',
                owner: 'owner123',
                size_matched: '0',
                type: 'PLACEMENT'
            };

            // Call the internal handler directly for testing
            await (manager as any).handlers.onOrder([orderEvent]);

            // Since we don't have the market subscribed, it might not call the handler
            // But it should not error
            expect(mockHandlers.onError).not.toHaveBeenCalled();
        });

        it('should handle trade events', async () => {
            const tradeEvent: TradeEvent = {
                event_type: 'trade',
                trade_id: 'trade123',
                order_id: 'order123',
                asset_id: 'asset123',
                market: 'market123',
                side: 'SELL',
                size: '50',
                price: '0.6',
                fee: '0.01',
                timestamp: '1640000000000'
            };

            // Call the internal handler directly for testing
            await (manager as any).handlers.onTrade([tradeEvent]);

            // Should not error
            expect(mockHandlers.onError).not.toHaveBeenCalled();
        });

        it('should delegate onWSClose to user handlers', async () => {
            await (manager as any).handlers.onWSClose('group1', 1000, 'Normal closure');

            expect(mockHandlers.onWSClose).toHaveBeenCalledWith('group1', 1000, 'Normal closure');
        });

        it('should delegate onWSOpen to user handlers', async () => {
            await (manager as any).handlers.onWSOpen('group1', ['market1']);

            expect(mockHandlers.onWSOpen).toHaveBeenCalledWith('group1', ['market1']);
        });

        it('should delegate onError to user handlers', async () => {
            const error = new Error('Test error');
            
            await (manager as any).handlers.onError(error);

            expect(mockHandlers.onError).toHaveBeenCalledWith(error);
        });
    });

    describe('periodic cleanup', () => {
        it('should set up periodic reconnection check', () => {
            expect(vi.getTimerCount()).toBe(1);
        });

        it('should handle reconnection errors gracefully', async () => {
            // Trigger the interval
            vi.advanceTimersByTime(10000);

            // Should not throw errors during reconnection
            expect(mockHandlers.onError).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('reconnection')
                })
            );
        });
    });

    describe('error handling', () => {
        it('should handle bottleneck errors', () => {
            // Create a manager to get the bottleneck instance
            const testManager = new UserWSSubscriptionManager(mockHandlers, {
                auth: mockAuth
            });
            
            // Get the mocked bottleneck instance
            const bottleneckInstance = (testManager as any).burstLimiter;
            
            // Verify that the on method was called with 'error'
            expect(bottleneckInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
        });
    });
});