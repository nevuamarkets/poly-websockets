/**
 * Connection status for the WebSocket.
 */
export enum WebSocketConnectionStatus {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
}

/**
 * Options for configuring the WSSubscriptionManager.
 */
export type SubscriptionManagerOptions = {
    /**
     * How often to check for reconnection (in milliseconds).
     * Default: 5000ms (5 seconds)
     * 
     * Note: We intentionally use a static interval rather than exponential backoff.
     * Perhaps change this to exponential backoff in the future.
     */
    reconnectAndCleanupIntervalMs?: number;

    /**
     * How often to flush pending subscriptions to the WebSocket (in milliseconds).
     * Default: 100ms
     */
    pendingFlushIntervalMs?: number;
}
