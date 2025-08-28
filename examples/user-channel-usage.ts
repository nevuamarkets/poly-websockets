import {
    UserWSSubscriptionManager,
    UserWebSocketHandlers,
    OrderEvent,
    TradeEvent,
    Side,
    OrderType,
    TradeStatus
} from '@nevuamarkets/poly-websockets';

// Example usage of the User Channel WebSocket

(async () => {
    // Your Polymarket API credentials
    const auth = {
        apiKey: 'your-api-key',
        secret: 'your-secret',
        passphrase: 'your-passphrase'
    };

    // Create handlers for user events
    const userHandlers: UserWebSocketHandlers = {
        onOrder: async (events: OrderEvent[]) => {
            for (const event of events) {
                console.log('Order Event:', {
                    orderId: event.id,
                    market: event.market,
                    side: event.side,
                    originalSize: event.original_size,
                    price: event.price,
                    timestamp: new Date(parseInt(event.timestamp)).toISOString(),
                    outcome: event.outcome,
                    orderType: event.type,
                    sizeMatched: event.size_matched,
                    owner: event.owner,
                    orderOwner: event.order_owner
                });
            }
        },

        onTrade: async (events: TradeEvent[]) => {
            for (const event of events) {
                console.log('Trade Event:', {
                    tradeId: event.id,
                    market: event.market,
                    side: event.side,
                    size: event.size,
                    price: event.price,
                    status: event.status,
                    outcome: event.outcome,
                    timestamp: new Date(parseInt(event.timestamp)).toISOString(),
                    takerOrderId: event.taker_order_id,
                    tradeOwner: event.trade_owner,
                    makerOrders: event.maker_orders.length
                });
            }
        },

        onError: async (error: Error) => {
            console.error('User WebSocket Error:', error.message);
        },

        onWSOpen: async (groupId: string, marketIds: string[]) => {
            console.log(`User WebSocket opened for group ${groupId} with ${marketIds.length} markets`);
        },

        onWSClose: async (groupId: string, code: number, reason: string) => {
            console.log(`User WebSocket closed for group ${groupId}: ${code} - ${reason}`);
        }
    };

    // Create the user subscription manager
    const userManager = new UserWSSubscriptionManager(userHandlers, {
        auth,
        maxMarketsPerWS: 50, // Optional: max markets per WebSocket connection
        reconnectAndCleanupIntervalMs: 10000 // Optional: cleanup interval
    });

    // Subscribe to specific markets for user events
    const marketIds = [
        '0x1234567890abcdef...', // Replace with actual condition IDs
        '0xabcdef1234567890...'
    ];

    try {
        // Option 1: Subscribe to specific markets
        await userManager.addSubscriptions(marketIds);
        console.log(`Subscribed to user events for ${marketIds.length} markets`);

        // Option 2: Subscribe to all user events (no filtering)
        // await userManager.addSubscriptions(); // No arguments
        // await userManager.addSubscriptions([]); // Empty array
        // console.log('Subscribed to all user events without filtering');

        // Keep the process running to receive events
        console.log('Listening for user events... Press Ctrl+C to exit');
        
        // In a real application, you would keep this running
        // For this example, we'll clean up after 30 seconds
        setTimeout(async () => {
            await userManager.clearState();
            console.log('User channel subscriptions cleared');
            process.exit(0);
        }, 30000);

    } catch (error) {
        console.error('Failed to subscribe to user events:', error);
        process.exit(1);
    }
})();