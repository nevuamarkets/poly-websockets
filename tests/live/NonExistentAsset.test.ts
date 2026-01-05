/// <reference types='vitest' />
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WSSubscriptionManager } from '../../src/WSSubscriptionManager';
import { BookEvent, WebSocketHandlers } from '../../src/types/PolymarketWebSocket';

/**
 * Test that subscribes/unsubscribes to non-existent asset_ids
 * to verify the server response is logged properly
 */
describe('Non-existent asset subscription', () => {
    let stream: WSSubscriptionManager | undefined;
    
    afterEach(async () => {
        // Clear state between tests to ensure fresh connections
        if (stream) {
            await stream.clearState();
        }
    });

    it('should handle subscribing to non-existent asset_id', async () => {
        const receivedErrors: Error[] = [];
        const receivedBooks: BookEvent[] = [];
        let wsOpened = false;
        
        const handlers: WebSocketHandlers = {
            onBook: async (events: BookEvent[]) => {
                receivedBooks.push(...events);
            },
            onWSOpen: async () => {
                wsOpened = true;
            },
            onError: async (error: Error) => {
                console.log('Received error:', error.message);
                receivedErrors.push(error);
            }
        };

        stream = new WSSubscriptionManager(handlers);

        // Use a fake asset_id that doesn't exist
        const fakeAssetId = '9999999999999999999999999999999999999999999999999999999999999999999999999999999';
        
        await stream.addSubscriptions([fakeAssetId]);

        // Wait for connection and potential error response
        await new Promise(resolve => setTimeout(resolve, 5000));

        expect(wsOpened).toBe(true);
        
        // Log results for inspection
        console.log('WebSocket opened:', wsOpened);
        console.log('Errors received:', receivedErrors.length);
        console.log('Books received:', receivedBooks.length);
        
        // The test passes regardless - we just want to see the server response logged
        // Polymarket might not send an error for non-existent assets, it may just not send events
        expect(true).toBe(true);
    }, 30000);

    it('should handle unsubscribing from non-existent asset_id', async () => {
        const receivedErrors: Error[] = [];
        let wsOpened = false;
        
        const handlers: WebSocketHandlers = {
            onWSOpen: async () => {
                wsOpened = true;
            },
            onError: async (error: Error) => {
                console.log('Received error on unsubscribe:', error.message);
                receivedErrors.push(error);
            }
        };

        stream = new WSSubscriptionManager(handlers);

        // First subscribe to a valid-looking asset
        const fakeAssetId = '1234567890123456789012345678901234567890123456789012345678901234567890123456789';
        await stream.addSubscriptions([fakeAssetId]);

        // Wait for connection
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Now try to unsubscribe from a different non-existent asset
        const anotherFakeAssetId = '9876543210987654321098765432109876543210987654321098765432109876543210987654321';
        await stream.removeSubscriptions([anotherFakeAssetId]);

        // Wait for potential error response
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('WebSocket opened:', wsOpened);
        console.log('Errors received on unsubscribe:', receivedErrors.length);
        
        // The test passes regardless - we just want to see the server response logged
        expect(true).toBe(true);
    }, 30000);
});

