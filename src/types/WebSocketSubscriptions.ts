import Bottleneck from 'bottleneck';
import WebSocket from 'ws';

/**
 * Authentication credentials for user channel WebSocket connection
 */
export interface ApiCredentials {
    apiKey: string;
    secret: string;
    passphrase: string;
}

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

export type UserWebSocketGroup = {
    groupId: string;
    marketIds: Set<string>;
    wsClient: WebSocket | null;
    status: WebSocketStatus;
    auth: ApiCredentials;
    subscribeToAll?: boolean;
};

export type SubscriptionManagerOptions = {
    burstLimiter?: Bottleneck;

    // How often to check for groups to reconnect and cleanup
    reconnectAndCleanupIntervalMs?: number;

    // How many assets to allow per WebSocket (default: unlimited since Polymarket removed the 100 token limit)
    maxMarketsPerWS?: number;

    // Whether to receive the initial order book state when subscribing (default: true)
    initialDump?: boolean;
}

export type UserSubscriptionManagerOptions = {
    burstLimiter?: Bottleneck;

    // How often to check for groups to reconnect and cleanup
    reconnectAndCleanupIntervalMs?: number;

    // How many markets to allow per WebSocket (default: unlimited since Polymarket removed the 100 token limit)
    maxMarketsPerWS?: number;

    // Authentication credentials for user channel
    auth: ApiCredentials;
}