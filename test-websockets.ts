// Set log level BEFORE importing modules (logger is initialized on import)
if (!process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = 'info';
}

import {
    WSSubscriptionManager,
    PolymarketPriceUpdateEvent,
    BookEvent,
    LastTradePriceEvent,
    PriceChangeEvent,
} from './src/index';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Tracks server responses to verify subscription success.
 * After subscribe/unsubscribe, if we receive any event for those assets,
 * or if no error is received, we consider it a success.
 */
interface ServerResponseTracker {
    subscribesSent: number;
    unsubscribesSent: number;
    booksReceived: number;
    priceChangesReceived: number;
    lastTradePricesReceived: number;
    errorsReceived: number;
    assetsWithBookEvents: Set<string>;
}



interface ClobTokenIdEntry {
    clobTokenId: string;
}

function fetchAllClobTokenIds(): string[] {
    const filePath = join(__dirname, 'MongoDB.materialized_subscriptions.json');
    const fileContent = readFileSync(filePath, 'utf-8');
    const entries: ClobTokenIdEntry[] = JSON.parse(fileContent);
    
    const clobTokenIds = entries.map(entry => entry.clobTokenId).filter(id => id);

    console.log(`Found ${clobTokenIds.length} clobTokenIds in MongoDB.materialized_subscriptions.json`);
    return clobTokenIds;
}

async function testScenarioA(clobTokenIds: string[], manager: WSSubscriptionManager) {
    console.log('\n=== Scenario A: Subscribe to all in one go ===');
    console.log(`Subscribing to ${clobTokenIds.length} clobTokenIds at once...`);
    
    const startTime = Date.now();
    await manager.addSubscriptions(clobTokenIds);
    const endTime = Date.now();
    
    console.log(`✅ Subscribed to all ${clobTokenIds.length} clobTokenIds in ${endTime - startTime}ms`);
}

async function testScenarioB(clobTokenIds: string[], manager: WSSubscriptionManager) {
    console.log('\n=== Scenario B: Subscribe to all in close succession (in a loop) ===');
    const testAssets = clobTokenIds.slice(0, 100); // Only test with 100 assets
    console.log(`Subscribing to ${testAssets.length} clobTokenIds one by one...`);
    
    const startTime = Date.now();
    for (const clobTokenId of testAssets) {
        await manager.addSubscriptions([clobTokenId]);
    }
    const endTime = Date.now();
    
    console.log(`✅ Subscribed to all ${testAssets.length} clobTokenIds one by one in ${endTime - startTime}ms`);
}

async function testScenarioC(clobTokenIds: string[], manager: WSSubscriptionManager) {
    console.log('\n=== Scenario C: Unsubscribe from some random ones ===');
    
    // Get currently monitored assets from statistics
    const stats = manager.getStatistics();
    const assetCount = stats.assetIds;
    
    // Unsubscribe from 100 random assets (or all if less than 100)
    const unsubscribeCount = Math.min(100, assetCount);
    
    // Get a sample of assets to unsubscribe (we'll use the first 100 from the original list that are likely subscribed)
    const toUnsubscribe = clobTokenIds.slice(0, unsubscribeCount);
    console.log(`Unsubscribing from ${toUnsubscribe.length} random clobTokenIds...`);
    
    const startTime = Date.now();
    await manager.removeSubscriptions(toUnsubscribe);
    const endTime = Date.now();
    
    console.log(`✅ Unsubscribed from ${toUnsubscribe.length} clobTokenIds in ${endTime - startTime}ms`);
    console.log(`Sample unsubscribed IDs: ${toUnsubscribe.slice(0, 5).join(', ')}`);
}

async function testScenarioD(manager: WSSubscriptionManager) {
    console.log('\n=== Scenario D: Test getAssetIds method ===');
    
    const allAssets = manager.getAssetIds();
    
    console.log(`📊 Total monitored assets: ${allAssets.length}`);
    console.log(`Sample monitored IDs: ${allAssets.slice(0, 3).join(', ')}`);
}

async function testScenarioE(clobTokenIds: string[], manager: WSSubscriptionManager) {
    console.log('\n=== Scenario E: Re-subscribe to 100 random assets ===');
    
    // Pick 100 random assets
    const shuffled = [...clobTokenIds].sort(() => Math.random() - 0.5);
    const toSubscribe = shuffled.slice(0, 100);
    
    console.log(`Re-subscribing to ${toSubscribe.length} random clobTokenIds...`);
    
    const startTime = Date.now();
    await manager.addSubscriptions(toSubscribe);
    const endTime = Date.now();
    
    console.log(`✅ Re-subscribed to ${toSubscribe.length} clobTokenIds in ${endTime - startTime}ms`);
    console.log(`Sample subscribed IDs: ${toSubscribe.slice(0, 3).join(', ')}`);
}

async function main() {
    try {
        console.log('Starting WebSocket test script...\n');
        console.log(`Log level: ${process.env.LOG_LEVEL || 'warn (default)'}`);

        // Fetch all clobTokenIds
        const clobTokenIds = fetchAllClobTokenIds();
        
        if (clobTokenIds.length === 0) {
            console.log('No clobTokenIds found. Exiting.');
            return;
        }

        // Track server responses
        const tracker: ServerResponseTracker = {
            subscribesSent: 0,
            unsubscribesSent: 0,
            booksReceived: 0,
            priceChangesReceived: 0,
            lastTradePricesReceived: 0,
            errorsReceived: 0,
            assetsWithBookEvents: new Set<string>(),
        };

        // Create WebSocket manager
        console.log('\nCreating WebSocket manager...');
        
        const manager = new WSSubscriptionManager({
            onPolymarketPriceUpdate: async (events: PolymarketPriceUpdateEvent[]) => {
                console.log(`📊 Received ${events.length} price update events`);
                events.slice(0, 3).forEach(event => {
                    console.log(`  - ${event.asset_id}: ${event.price}`);
                });
            },
            onBook: async (events: BookEvent[]) => {
                tracker.booksReceived += events.length;
                events.forEach(event => tracker.assetsWithBookEvents.add(event.asset_id));
                console.log(`📖 Received ${events.length} book events (total: ${tracker.booksReceived})`);
            },
            onLastTradePrice: async (events: LastTradePriceEvent[]) => {
                tracker.lastTradePricesReceived += events.length;
                // Log the first event to check for transaction_hash field
                if (events.length > 0) {
                    console.log(`💰 Received ${events.length} last trade price events`);
                    console.log('  Sample LastTradePriceEvent keys:', Object.keys(events[0]));
                    console.log('  Sample event:', JSON.stringify(events[0], null, 2));
                }
            },
            onPriceChange: async (events: PriceChangeEvent[]) => {
                tracker.priceChangesReceived += events.length;
            },
            onWSOpen: async (managerId: string, assetIds: string[]) => {
                console.log(`🔌 WebSocket opened (managerId: ${managerId.slice(0, 8)}...) with ${assetIds.length} pending assets`);
            },
            onWSClose: async (managerId: string, code: number, reason: string) => {
                console.log(`🔌 WebSocket closed (managerId: ${managerId.slice(0, 8)}...) (code: ${code}, reason: ${reason})`);
            },
            onError: async (error: Error) => {
                tracker.errorsReceived++;
                console.error('❌ WebSocket error:', error.message);
            },
        }, {
            reconnectAndCleanupIntervalMs: 5000, // 5 seconds for reconnection
        });

        // Start periodic statistics printing (every 10 seconds to reduce noise)
        const statsInterval = setInterval(() => {
            const stats = manager.getStatistics();
            console.log('\n📊 WebSocket Statistics:');
            console.log(JSON.stringify(stats, null, 2));
            console.log('📈 Server Response Tracker:');
            console.log(`  Books received: ${tracker.booksReceived}`);
            console.log(`  Price changes: ${tracker.priceChangesReceived}`);
            console.log(`  Last trade prices: ${tracker.lastTradePricesReceived}`);
            console.log(`  Errors received: ${tracker.errorsReceived}`);
            console.log(`  Unique assets with book events: ${tracker.assetsWithBookEvents.size}`);
        }, 5000);

        // Test Scenario A: Subscribe to all in one go
        const booksBefore = tracker.booksReceived;
        await testScenarioA(clobTokenIds, manager);
        tracker.subscribesSent += clobTokenIds.length;
        
        // Wait for server responses (book events)
        console.log('\nWaiting 10 seconds for server responses...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Verify subscription success
        const booksAfterA = tracker.booksReceived;
        if (booksAfterA > booksBefore) {
            console.log(`✅ SUBSCRIPTION SUCCESS: Received ${booksAfterA - booksBefore} book events after subscribing`);
            console.log(`   Unique assets with book data: ${tracker.assetsWithBookEvents.size}/${clobTokenIds.length}`);
        } else if (tracker.errorsReceived === 0) {
            console.log(`⚠️  No book events received, but no errors either. Server accepted subscriptions silently.`);
        } else {
            console.log(`❌ SUBSCRIPTION ISSUE: No book events and ${tracker.errorsReceived} errors received`);
        }

        // Test new getAssetIds method
        await testScenarioD(manager);

        // Clear state before scenario B
        console.log('\nClearing WebSocket state...');
        await manager.clearState();
        // Reset tracker for next test
        tracker.booksReceived = 0;
        tracker.errorsReceived = 0;
        tracker.assetsWithBookEvents.clear();
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Test Scenario B: Subscribe to all in close succession
        await testScenarioB(clobTokenIds, manager);
        
        // Wait for server responses
        console.log('\nWaiting 10 seconds for server responses...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Verify subscription success
        if (tracker.booksReceived > 0) {
            console.log(`✅ SUBSCRIPTION SUCCESS (Scenario B): Received ${tracker.booksReceived} book events`);
        }

        // Test Scenario C: Unsubscribe from some random ones
        const booksBeforeUnsub = tracker.booksReceived;
        await testScenarioC(clobTokenIds, manager);
        tracker.unsubscribesSent += 100;
        
        // Wait and check - after unsubscribe, we shouldn't receive errors
        console.log('\nWaiting 10 seconds to verify unsubscribe...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log(`📋 Unsubscribe verification: No errors means success. Errors so far: ${tracker.errorsReceived}`);

        // Test Scenario E: Re-subscribe to 100 random assets
        await testScenarioE(clobTokenIds, manager);

        // Wait for final responses
        console.log('\nWaiting 10 seconds for final responses...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Final summary
        console.log('\n' + '='.repeat(60));
        console.log('📋 FINAL SERVER RESPONSE SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total book events received: ${tracker.booksReceived}`);
        console.log(`Total price change events: ${tracker.priceChangesReceived}`);
        console.log(`Total last trade price events: ${tracker.lastTradePricesReceived}`);
        console.log(`Total errors received: ${tracker.errorsReceived}`);
        console.log(`Unique assets that sent book data: ${tracker.assetsWithBookEvents.size}`);
        console.log('='.repeat(60));
        
        if (tracker.errorsReceived === 0 && tracker.booksReceived > 0) {
            console.log('✅ TEST PASSED: Server responded to subscriptions with data, no errors');
        } else if (tracker.errorsReceived === 0) {
            console.log('⚠️  TEST INCONCLUSIVE: No errors but also no book events (maybe inactive markets)');
        } else {
            console.log(`❌ TEST FAILED: ${tracker.errorsReceived} errors received`);
        }

        console.log('\n✅ All test scenarios completed. Cleaning up and exiting...');
        clearInterval(statsInterval);
        await manager.clearState();
        process.exit(0);

    } catch (error) {
        console.error('Error in test script:', error);
        process.exit(1);
    }
}

main();
