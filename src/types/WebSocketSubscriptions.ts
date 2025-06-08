import Bottleneck from 'bottleneck';
import WebSocket from 'ws';

export enum WebSocketStatus {
    PENDING = 'pending', // New group that is pending connection
    ALIVE = 'alive',    // Group is connected and receiving events
    DEAD = 'dead',      // Group is disconnected
    CLEANUP = 'cleanup' // Group is marked for cleanup
}

export type WebSocketGroup = {
    groupId: string;
    assetIds: Set<string>;
    wsClient: WebSocket | null;
    status: WebSocketStatus;
};

export type SubscriptionManagerOptions = {
    burstLimiter?: Bottleneck;

    // How often to check for groups to reconnect and cleanup
    reconnectAndCleanupIntervalMs?: number;

    // How many assets to allow per WebSocket
    maxMarketsPerWS?: number;
}