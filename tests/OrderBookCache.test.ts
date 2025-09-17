/// <reference types="vitest" />
import { describe, it, expect, beforeEach } from 'vitest';
import { OrderBookCache } from '../src/modules/OrderBookCache';
import {
    BookEvent,
    PriceChangeEvent,
    PriceLevel,
} from '../src/types/PolymarketWebSocket';

const ASSET_ID = 'asset-1'; 

describe('OrderBookCache', () => {
    let bookCache: OrderBookCache;

    beforeEach(() => {
        bookCache = new OrderBookCache();
        bookCache.clear();
    });

    // Used for asks (sells)
    function assertDescending(bookSide: PriceLevel[]): void {
        for (let i = 1; i < bookSide.length; i++) {
            expect(parseFloat(bookSide[i].price)).toBeLessThan(parseFloat(bookSide[i - 1].price));
        }
    }

    // Used for bids (buys)
    function assertAscending(bookSide: PriceLevel[]): void {
        for (let i = 1; i < bookSide.length; i++) {
            expect(parseFloat(bookSide[i].price)).toBeGreaterThan(parseFloat(bookSide[i - 1].price));
        }
    }

    it('replaceBook should populate cache & keep ascending order for bids & descending order for asks', () => {
        const bookEvt: BookEvent = {
            asset_id: ASSET_ID,
            market: 'm',
            timestamp: '0',
            hash: 'h',
            event_type: 'book',
            bids: [
                { price: '0.01', size: '10' },
                { price: '0.02', size: '5' }
            ],
            asks: [
                { price: '0.99', size: '2' },
                { price: '0.98', size: '1' }   
            ]
        };

        bookCache.replaceBook(bookEvt);

        assertAscending(bookCache.getBookEntry(ASSET_ID)!.bids);
        assertDescending(bookCache.getBookEntry(ASSET_ID)!.asks);

        const mid = bookCache.midpoint(ASSET_ID);
        expect(mid).toBe('0.5'); // (0.98 + 0.02)/2 → 0.5
        expect(bookCache.spreadOver(ASSET_ID, 0.1)).toBe(true); // 0.98 - 0.02 = 0.96 > 0.1
    });

    it('Test spread when exactly 0.1', () => {
        const bookEvt: BookEvent = {
            asset_id: ASSET_ID,
            market: 'm',
            timestamp: '0',
            hash: 'h',
            event_type: 'book',
            bids: [
                { price: '0.1', size: '10' },
                { price: '0.2', size: '5' }
            ],
            asks: [
                { price: '0.4', size: '2' },
                { price: '0.3', size: '1' }   
            ]
        };

        bookCache.replaceBook(bookEvt);

        assertAscending(bookCache.getBookEntry(ASSET_ID)!.bids);
        assertDescending(bookCache.getBookEntry(ASSET_ID)!.asks);

        const mid = bookCache.midpoint(ASSET_ID);
        expect(mid).toBe('0.25'); // (0.2 + 0.3)/2 → 0.25
        expect(bookCache.spreadOver(ASSET_ID, 0.1)).toBe(false); // 0.3 - 0.2 = 0.1 
    });

    it('upsertPriceChange should update existing level & recalc spread', () => {
        // seed cache
        const bookEvt: BookEvent = {
            asset_id: ASSET_ID,
            market: 'm',
            timestamp: '0',
            hash: 'h',
            event_type: 'book',
            bids: [
                { price: '0.01', size: '10' },
                { price: '0.02', size: '5' }
            ],
            asks: [
                { price: '0.98', size: '1' },
                { price: '0.99', size: '2' }
            ]
        };
        bookCache.replaceBook(bookEvt);

        const priceChange: PriceChangeEvent = {
            market: 'm',
            timestamp: '1',
            event_type: 'price_change',
            price_changes: [
                { 
                    asset_id: ASSET_ID,
                    price: '0.90', 
                    side: 'BUY', 
                    size: '3',
                    hash: 'x',
                    best_bid: '0.90',
                    best_ask: '0.98'
                }
            ]
        };

        bookCache.upsertPriceChange(priceChange);

        assertAscending(bookCache.getBookEntry(ASSET_ID)!.bids);
        assertDescending(bookCache.getBookEntry(ASSET_ID)!.asks);
        
        expect(bookCache.spreadOver(ASSET_ID, 0.1)).toBe(false); // 0.99 - 0.9 = 0.09
        expect(bookCache.midpoint(ASSET_ID)).toBe('0.94');
    });

    it('spreadOver should throw if no asks', () => {
        // seed cache
        const bookEvt: BookEvent = {
            asset_id: ASSET_ID,
            market: 'm',
            timestamp: '0',
            hash: 'h',
            event_type: 'book',
            bids: [
                { price: '0.01', size: '10' },
                { price: '0.02', size: '5' }
            ],
            asks: [
            ]
        };
        bookCache.replaceBook(bookEvt);

        expect(() => bookCache.spreadOver(ASSET_ID, 0.1)).toThrow('No asks in book');
    });

    it('spreadOver should throw if no bids', () => {
        // seed cache
        const bookEvt: BookEvent = {
            asset_id: ASSET_ID,
            market: 'm',
            timestamp: '0',
            hash: 'h',
            event_type: 'book',
            bids: [
            ],
            asks: [
                { price: '0.98', size: '1' },
            ]
        };
        bookCache.replaceBook(bookEvt);

        expect(() => bookCache.spreadOver(ASSET_ID, 0.1)).toThrow('No bids in book');
    });

    it('spreadOver should throw if NaN', () => {
        // seed cache
        const bookEvt: BookEvent = {
            asset_id: ASSET_ID,
            market: 'm',
            timestamp: '0',
            hash: 'h',
            event_type: 'book',
            bids: [
                { price: '0.01', size: '10' },
                { price: '0.02', size: '5' }
            ],
            asks: [
                { price: 'A', size: '1' },
            ]
        };
        bookCache.replaceBook(bookEvt);

        expect(() => bookCache.spreadOver(ASSET_ID, 0.1)).toThrow("Spread is NaN: lowestAsk 'A' highestBid '0.02'");
    });
}); 