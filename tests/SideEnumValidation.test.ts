/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';
import { PriceChangeEvent, Side } from '../src/types/PolymarketWebSocket';

describe('Side Enum Validation', () => {
    it('should accept valid Side enum values in PriceChangeEvent', () => {
        const priceChangeEvent: PriceChangeEvent = {
            asset_id: 'test-asset',
            market: 'test-market',
            timestamp: '1234567890',
            hash: 'test-hash',
            event_type: 'price_change',
            changes: [
                { price: '0.50', side: Side.BUY, size: '100' },
                { price: '0.55', side: Side.SELL, size: '200' }
            ]
        };

        expect(priceChangeEvent.changes[0].side).toBe(Side.BUY);
        expect(priceChangeEvent.changes[1].side).toBe(Side.SELL);
        expect(priceChangeEvent.changes[0].side).toBe('BUY');
        expect(priceChangeEvent.changes[1].side).toBe('SELL');
    });

    it('should validate Side enum values', () => {
        expect(Side.BUY).toBe('BUY');
        expect(Side.SELL).toBe('SELL');
        expect(Object.values(Side)).toEqual(['BUY', 'SELL']);
    });
});