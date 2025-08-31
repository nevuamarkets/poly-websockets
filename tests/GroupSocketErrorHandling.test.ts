/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupSocket } from '../src/modules/GroupSocket';
import { UserGroupSocket } from '../src/modules/UserGroupSocket';
import { WebSocketGroup, UserWebSocketGroup, WebSocketStatus } from '../src/types/WebSocketSubscriptions';
import { WebSocketHandlers, UserWebSocketHandlers } from '../src/types/PolymarketWebSocket';
import { OrderBookCache } from '../src/modules/OrderBookCache';
import Bottleneck from 'bottleneck';
import WebSocket from 'ws';

// Mock WebSocket
vi.mock('ws');
const MockedWebSocket = vi.mocked(WebSocket);

describe('WebSocket Error Handling on Open', () => {
    let mockLimiter: Bottleneck;
    let mockBookCache: OrderBookCache;
    let mockHandlers: WebSocketHandlers;
    let mockUserHandlers: UserWebSocketHandlers;

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockLimiter = {
            schedule: vi.fn().mockImplementation(async (opts, fn) => fn())
        } as any;
        
        mockBookCache = {} as OrderBookCache;
        
        mockHandlers = {
            onError: vi.fn(),
            onWSOpen: vi.fn(),
            onWSClose: vi.fn()
        };

        mockUserHandlers = {
            onError: vi.fn(),
            onWSOpen: vi.fn(),
            onWSClose: vi.fn()
        };
    });

    describe('GroupSocket', () => {
        it('should handle WebSocket send error in handleOpen and mark group as DEAD', async () => {
            const group: WebSocketGroup = {
                groupId: 'test-group',
                assetIds: new Set(['asset1', 'asset2']),
                wsClient: null,
                status: WebSocketStatus.PENDING
            };

            const groupSocket = new GroupSocket(group, mockLimiter, mockBookCache, mockHandlers);

            // Mock WebSocket that throws on send
            const mockWS = {
                on: vi.fn(),
                removeAllListeners: vi.fn(),
                send: vi.fn().mockImplementation(() => {
                    throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
                })
            } as any;

            MockedWebSocket.mockReturnValue(mockWS);

            // Connect the socket
            await groupSocket.connect();

            expect(group.wsClient).toBe(mockWS);
            expect(mockWS.on).toHaveBeenCalledWith('open', expect.any(Function));

            // Get the handleOpen function that was registered
            const openHandler = mockWS.on.mock.calls.find(call => call[0] === 'open')?.[1];
            expect(openHandler).toBeDefined();

            // Simulate the 'open' event
            await openHandler();

            // The group should be marked as DEAD due to send error
            expect(group.status).toBe(WebSocketStatus.DEAD);
            
            // onWSOpen should not be called since send failed
            expect(mockHandlers.onWSOpen).not.toHaveBeenCalled();
        });

        it('should successfully send subscription message when WebSocket is ready', async () => {
            const group: WebSocketGroup = {
                groupId: 'test-group',
                assetIds: new Set(['asset1', 'asset2']),
                wsClient: null,
                status: WebSocketStatus.PENDING
            };

            const groupSocket = new GroupSocket(group, mockLimiter, mockBookCache, mockHandlers);

            // Mock WebSocket that succeeds on send
            const mockWS = {
                on: vi.fn(),
                removeAllListeners: vi.fn(),
                send: vi.fn()
            } as any;

            MockedWebSocket.mockReturnValue(mockWS);

            // Connect the socket
            await groupSocket.connect();

            // Get the handleOpen function that was registered
            const openHandler = mockWS.on.mock.calls.find(call => call[0] === 'open')?.[1];
            expect(openHandler).toBeDefined();

            // Simulate the 'open' event
            await openHandler();

            // The group should be marked as ALIVE
            expect(group.status).toBe(WebSocketStatus.ALIVE);
            
            // Send should have been called with correct subscription message
            expect(mockWS.send).toHaveBeenCalledWith(
                JSON.stringify({ assets_ids: ['asset1', 'asset2'], type: 'market', initial_dump: true })
            );
            
            // onWSOpen should be called
            expect(mockHandlers.onWSOpen).toHaveBeenCalledWith('test-group', ['asset1', 'asset2']);
        });
    });

    describe('UserGroupSocket', () => {
        it('should handle WebSocket send error in handleOpen and mark group as DEAD', async () => {
            const group: UserWebSocketGroup = {
                groupId: 'test-user-group',
                marketIds: new Set(['market1', 'market2']),
                wsClient: null,
                status: WebSocketStatus.PENDING,
                subscribeToAll: false,
                auth: {
                    apiKey: 'test-key',
                    secret: 'test-secret',
                    passphrase: 'test-passphrase'
                }
            };

            const userGroupSocket = new UserGroupSocket(group, mockLimiter, mockUserHandlers);

            // Mock WebSocket that throws on send
            const mockWS = {
                on: vi.fn(),
                removeAllListeners: vi.fn(),
                send: vi.fn().mockImplementation(() => {
                    throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
                })
            } as any;

            MockedWebSocket.mockReturnValue(mockWS);

            // Connect the socket
            await userGroupSocket.connect();

            expect(group.wsClient).toBe(mockWS);
            expect(mockWS.on).toHaveBeenCalledWith('open', expect.any(Function));

            // Get the handleOpen function that was registered
            const openHandler = mockWS.on.mock.calls.find(call => call[0] === 'open')?.[1];
            expect(openHandler).toBeDefined();

            // Simulate the 'open' event
            await openHandler();

            // The group should be marked as DEAD due to send error
            expect(group.status).toBe(WebSocketStatus.DEAD);
            
            // onWSOpen should not be called since send failed
            expect(mockUserHandlers.onWSOpen).not.toHaveBeenCalled();
        });

        it('should successfully send subscription message when WebSocket is ready', async () => {
            const group: UserWebSocketGroup = {
                groupId: 'test-user-group',
                marketIds: new Set(['market1', 'market2']),
                wsClient: null,
                status: WebSocketStatus.PENDING,
                subscribeToAll: false,
                auth: {
                    apiKey: 'test-key',
                    secret: 'test-secret',
                    passphrase: 'test-passphrase'
                }
            };

            const userGroupSocket = new UserGroupSocket(group, mockLimiter, mockUserHandlers);

            // Mock WebSocket that succeeds on send
            const mockWS = {
                on: vi.fn(),
                removeAllListeners: vi.fn(),
                send: vi.fn()
            } as any;

            MockedWebSocket.mockReturnValue(mockWS);

            // Connect the socket
            await userGroupSocket.connect();

            // Get the handleOpen function that was registered
            const openHandler = mockWS.on.mock.calls.find(call => call[0] === 'open')?.[1];
            expect(openHandler).toBeDefined();

            // Simulate the 'open' event
            await openHandler();

            // The group should be marked as ALIVE
            expect(group.status).toBe(WebSocketStatus.ALIVE);
            
            // Send should have been called with correct subscription message
            expect(mockWS.send).toHaveBeenCalledWith(
                JSON.stringify({
                    markets: ['market1', 'market2'],
                    type: 'USER',
                    auth: {
                        apiKey: 'test-key',
                        secret: 'test-secret',
                        passphrase: 'test-passphrase'
                    }
                })
            );
            
            // onWSOpen should be called
            expect(mockUserHandlers.onWSOpen).toHaveBeenCalledWith('test-user-group', ['market1', 'market2']);
        });
    });
});