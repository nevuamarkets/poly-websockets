/// <reference types='vitest' />
import { describe, it, expect, beforeAll } from 'vitest';
import { WSSubscriptionManager } from '../../src/WSSubscriptionManager'
import { BookEvent, LastTradePriceEvent, PriceChangeEvent, PriceChangeItem, TickSizeChangeEvent, PriceLevel, WebSocketHandlers } from '../../src/types/PolymarketWebSocket'

const marketsQty = '100';
const marketsUrl = 'https://gamma-api.polymarket.com/markets'
type allEvents = {
    book: BookEvent[],
    lastTradePrice: LastTradePriceEvent[];
    priceChange: PriceChangeEvent[];
}

/**
 * Expected fields for each event type - must match the TypeScript types exactly.
 * If the server sends additional or missing fields, tests will fail.
 */
const EXPECTED_FIELDS = {
    BookEvent: ['market', 'asset_id', 'timestamp', 'hash', 'bids', 'asks', 'event_type'],
    LastTradePriceEvent: ['market', 'asset_id', 'timestamp', 'fee_rate_bps', 'price', 'side', 'event_type', 'size', 'transaction_hash'],
    PriceChangeEvent: ['market', 'timestamp', 'event_type', 'price_changes'],
    PriceChangeItem: ['asset_id', 'price', 'size', 'side', 'hash', 'best_bid', 'best_ask'],
    PriceLevel: ['price', 'size'],
};

/**
 * Validates that an object has exactly the expected fields - no more, no less.
 * Returns an error message if validation fails, null if successful.
 */
function validateExactFields(obj: Record<string, unknown>, expectedFields: string[], eventTypeName: string): string | null {
    const actualFields = Object.keys(obj).sort();
    const expected = [...expectedFields].sort();
    
    const missing = expected.filter(f => !actualFields.includes(f));
    const extra = actualFields.filter(f => !expected.includes(f));
    
    if (missing.length > 0 || extra.length > 0) {
        let error = `${eventTypeName} schema mismatch:\n`;
        if (missing.length > 0) {
            error += `  Missing fields: ${missing.join(', ')}\n`;
        }
        if (extra.length > 0) {
            error += `  Extra fields: ${extra.join(', ')}\n`;
        }
        error += `  Expected: [${expected.join(', ')}]\n`;
        error += `  Actual: [${actualFields.join(', ')}]\n`;
        error += `  Object: ${JSON.stringify(obj, null, 2)}`;
        return error;
    }
    
    return null;
}

/**
 * Unit tests for the validateExactFields function itself.
 * These tests verify that schema mismatches (extra/missing fields) are caught.
 */
describe('validateExactFields - Schema Validation', () => {
    const expectedFields = ['field_a', 'field_b', 'field_c'];

    it('should return null when object has exactly the expected fields', () => {
        const obj = { field_a: 'value', field_b: 123, field_c: true };
        const result = validateExactFields(obj, expectedFields, 'TestEvent');
        expect(result).toBeNull();
    });

    it('should detect EXTRA fields in the object', () => {
        const obj = { 
            field_a: 'value', 
            field_b: 123, 
            field_c: true, 
            unexpected_field: 'should fail' 
        };
        const result = validateExactFields(obj, expectedFields, 'TestEvent');
        
        expect(result).not.toBeNull();
        expect(result).toContain('schema mismatch');
        expect(result).toContain('Extra fields: unexpected_field');
    });

    it('should detect MISSING fields in the object', () => {
        const obj = { field_a: 'value', field_b: 123 }; // missing field_c
        const result = validateExactFields(obj, expectedFields, 'TestEvent');
        
        expect(result).not.toBeNull();
        expect(result).toContain('schema mismatch');
        expect(result).toContain('Missing fields: field_c');
    });

    it('should detect BOTH extra AND missing fields', () => {
        const obj = { 
            field_a: 'value', 
            field_b: 123, 
            // missing field_c
            new_field: 'extra' 
        };
        const result = validateExactFields(obj, expectedFields, 'TestEvent');
        
        expect(result).not.toBeNull();
        expect(result).toContain('schema mismatch');
        expect(result).toContain('Missing fields: field_c');
        expect(result).toContain('Extra fields: new_field');
    });

    it('should detect multiple extra fields', () => {
        const obj = { 
            field_a: 'value', 
            field_b: 123, 
            field_c: true,
            extra1: 'one',
            extra2: 'two',
            extra3: 'three'
        };
        const result = validateExactFields(obj, expectedFields, 'TestEvent');
        
        expect(result).not.toBeNull();
        expect(result).toContain('Extra fields: extra1, extra2, extra3');
    });

    it('should detect multiple missing fields', () => {
        const obj = { field_a: 'value' }; // missing field_b and field_c
        const result = validateExactFields(obj, expectedFields, 'TestEvent');
        
        expect(result).not.toBeNull();
        expect(result).toContain('Missing fields: field_b, field_c');
    });

    it('should include the event type name in error message', () => {
        const obj = { field_a: 'value', extra: 'field' };
        const result = validateExactFields(obj, expectedFields, 'MyCustomEventType');
        
        expect(result).not.toBeNull();
        expect(result).toContain('MyCustomEventType schema mismatch');
    });

    it('should include the actual object in error message for debugging', () => {
        const obj = { field_a: 'value', field_b: 123, unexpected: 'oops' };
        const result = validateExactFields(obj, expectedFields, 'TestEvent');
        
        expect(result).not.toBeNull();
        expect(result).toContain('"unexpected": "oops"');
    });

    // Simulate real-world scenario: Polymarket adds a new field
    it('should catch if Polymarket adds a new field to LastTradePriceEvent', () => {
        const simulatedServerResponse = {
            market: '0x123',
            asset_id: '456',
            timestamp: '1234567890',
            fee_rate_bps: '0',
            price: '0.5',
            side: 'BUY',
            event_type: 'last_trade_price',
            size: '100',
            transaction_hash: '0xabc',
            // Simulated NEW field that Polymarket might add in the future
            new_polymarket_field: 'some_value'
        };
        
        const result = validateExactFields(
            simulatedServerResponse, 
            EXPECTED_FIELDS.LastTradePriceEvent, 
            'LastTradePriceEvent'
        );
        
        expect(result).not.toBeNull();
        expect(result).toContain('Extra fields: new_polymarket_field');
    });

    // Simulate real-world scenario: Polymarket removes a field
    it('should catch if Polymarket removes a field from BookEvent', () => {
        const simulatedServerResponse = {
            market: '0x123',
            asset_id: '456',
            timestamp: '1234567890',
            // hash is MISSING - maybe Polymarket deprecated it
            bids: [],
            asks: [],
            event_type: 'book'
        };
        
        const result = validateExactFields(
            simulatedServerResponse, 
            EXPECTED_FIELDS.BookEvent, 
            'BookEvent'
        );
        
        expect(result).not.toBeNull();
        expect(result).toContain('Missing fields: hash');
    });
});

/**
 * Returns the top X markets by volume
 * @param {number} quantity The number of markets to return
 * @returns {Array<string>} The tokenIds of the marktes
 */
async function getTopMarketsByVolume(quantity:string): Promise<string[]> {
    let tokenIdsArray:string[];   
    tokenIdsArray = [];
    const queryParams = new URLSearchParams({
        limit: quantity, order: 'volumeNum', ascending: 'false', active: 'true', closed: 'false'
    })

    const response = await fetch(`${marketsUrl}?${queryParams.toString()}`);
    const data = await response.json() as any[];
    data.forEach((el:any) => {
        tokenIdsArray.push(JSON.parse(el.clobTokenIds)[0])
    });

    return tokenIdsArray;
}

/**
 * Creates a WS connection waits for all types of events
 * @param {string[]} tokenIdsArray an array of markets tokenIds
 * @returns {Promise<Promise<allEvents>, WSSubscriptionManager} 
 */
async function createConnection(tokenIdsArray: string[]): Promise<{
    data: Promise<allEvents>;
    stream: WSSubscriptionManager;
}> {
    let stream: WSSubscriptionManager | undefined;
    try {
        const data = new Promise<{    
                book: BookEvent[],
                lastTradePrice: LastTradePriceEvent[];
                priceChange: PriceChangeEvent[];
            }>((resolve, reject) => {
                const receivedEvents = { 
                    onWSOpen: false,
                    onBook: false,
                    onLastTradePrice: false,
                    onTickSizeChange: false,
                    onPriceChange: false
                };
            
                const collectedData: any = {}; 
                const checkAllEventsReceived = () => {
                    if (
                        receivedEvents.onWSOpen &&
                        receivedEvents.onBook &&
                        receivedEvents.onLastTradePrice &&
                        receivedEvents.onPriceChange
                    ) {
                        resolve(collectedData);
                    }
                };
                
                stream = new WSSubscriptionManager({
                    onBook: async (events: BookEvent[]) => {
                        receivedEvents.onBook = true;
                        collectedData.book = events;
                        checkAllEventsReceived();
                    },
                    onLastTradePrice: async (events: LastTradePriceEvent[]) => {
                        receivedEvents.onLastTradePrice = true;
                        collectedData.lastTradePrice = events;
                        checkAllEventsReceived();
                    },
                    onPriceChange: async (events: PriceChangeEvent[]) => {
                        receivedEvents.onPriceChange = true;
                        collectedData.priceChange = events;
                        checkAllEventsReceived();
                    },
                    onWSOpen: async () => {
                        receivedEvents.onWSOpen = true;
                        checkAllEventsReceived();
                    },
                    onError: async (error: Error) => reject(error)
                });
            stream.addSubscriptions(tokenIdsArray);
        });

        return { data: data, stream: stream! };
    } catch (e) {
        console.log('Error while creating connection: ', e);
        return undefined as any;
    }
}

let result:any;
let data:allEvents;

beforeAll(async () => {
    const tokenIdsArray = await getTopMarketsByVolume(marketsQty);
    result = await createConnection(tokenIdsArray);
    data = await result.data;
    result.stream.clearState();
}, 2000000)


describe('onBook', () => {
    let books:BookEvent[];
    beforeAll(() => {
        books = data.book;
    })

    it('should receive the orderbook', async() => {
        expect(books).toBeDefined();
        expect(books.length).toBeGreaterThan(0);
    })

    it('should have all expected fields with correct types', () => {
        books.forEach((book:BookEvent) => {
            expect(book.market).toBeTypeOf('string');
            expect(book.asset_id).toBeTypeOf('string');
            expect(book.timestamp).toBeTypeOf('string');
            expect(book.hash).toBeTypeOf('string');
            expect(Array.isArray(book.bids)).toBe(true);
            expect(Array.isArray(book.asks)).toBe(true);
            expect(book.event_type).toBe('book');
        });
    });

    it('should have EXACTLY the specified fields (no extra, no missing)', () => {
        books.forEach((book: BookEvent, index: number) => {
            const error = validateExactFields(book as unknown as Record<string, unknown>, EXPECTED_FIELDS.BookEvent, `BookEvent[${index}]`);
            if (error) {
                throw new Error(error);
            }
        });
    });

    it('should have PriceLevel with exactly price and size fields in bids', () => {
        books.forEach((book: BookEvent, bookIndex: number) => {
            book.bids.forEach((bid: PriceLevel, bidIndex: number) => {
                const error = validateExactFields(bid as unknown as Record<string, unknown>, EXPECTED_FIELDS.PriceLevel, `BookEvent[${bookIndex}].bids[${bidIndex}]`);
                if (error) {
                    throw new Error(error);
                }
                expect(bid.price).toBeTypeOf('string');
                expect(bid.size).toBeTypeOf('string');
            });
        });
    });

    it('should have PriceLevel with exactly price and size fields in asks', () => {
        books.forEach((book: BookEvent, bookIndex: number) => {
            book.asks.forEach((ask: PriceLevel, askIndex: number) => {
                const error = validateExactFields(ask as unknown as Record<string, unknown>, EXPECTED_FIELDS.PriceLevel, `BookEvent[${bookIndex}].asks[${askIndex}]`);
                if (error) {
                    throw new Error(error);
                }
                expect(ask.price).toBeTypeOf('string');
                expect(ask.size).toBeTypeOf('string');
            });
        });
    });
})

describe('onLastTradePrice', () => {
    let lastTradePrice: LastTradePriceEvent[];

    beforeAll(async () => {
        lastTradePrice = data.lastTradePrice;
    });

    it('should receive last trade price event', async() => {
        expect(lastTradePrice).toBeDefined();
        expect(lastTradePrice.length).toBeGreaterThan(0);
    })

    it('should have all expected fields with correct types', () => {
        lastTradePrice.forEach((ltp: LastTradePriceEvent) => {
            expect(ltp.asset_id).toBeTypeOf('string');
            expect(ltp.event_type).toBe('last_trade_price');
            expect(ltp.fee_rate_bps).toBeTypeOf('string');
            expect(ltp.market).toBeTypeOf('string');
            expect(ltp.price).toBeTypeOf('string');
            expect(ltp.side).toBeTypeOf('string');
            expect(ltp.size).toBeTypeOf('string');
            expect(ltp.timestamp).toBeTypeOf('string');
            expect(ltp.transaction_hash).toBeTypeOf('string');
        });
    });

    it('should have EXACTLY the specified fields (no extra, no missing)', () => {
        lastTradePrice.forEach((ltp: LastTradePriceEvent, index: number) => {
            const error = validateExactFields(ltp as unknown as Record<string, unknown>, EXPECTED_FIELDS.LastTradePriceEvent, `LastTradePriceEvent[${index}]`);
            if (error) {
                throw new Error(error);
            }
        });
    });
})

describe('onPriceChange', () => {
    let priceChange: PriceChangeEvent[];

    beforeAll(async () => {
        priceChange = data.priceChange;
    });

    it('should receive onPriceChange event', async() => {
        expect(priceChange).toBeDefined();
        expect(priceChange.length).toBeGreaterThan(0);
    })
    
    it('should have all expected fields with correct types', () => {
        priceChange.forEach((pc: PriceChangeEvent) => {
            expect(pc.market).toBeTypeOf('string');
            expect(pc.timestamp).toBeTypeOf('string');
            expect(pc.event_type).toBe('price_change');
            expect(Array.isArray(pc.price_changes)).toBe(true);
        });
    });

    it('should have EXACTLY the specified fields (no extra, no missing)', () => {
        priceChange.forEach((pc: PriceChangeEvent, index: number) => {
            const error = validateExactFields(pc as unknown as Record<string, unknown>, EXPECTED_FIELDS.PriceChangeEvent, `PriceChangeEvent[${index}]`);
            if (error) {
                throw new Error(error);
            }
        });
    });

    it('should have all expected fields with correct types in price_changes array', () => {
        priceChange.forEach((pc: PriceChangeEvent) => {
            pc.price_changes.forEach((item: PriceChangeItem) => {
                expect(item.asset_id).toBeTypeOf('string');
                expect(item.price).toBeTypeOf('string');
                expect(item.size).toBeTypeOf('string');
                expect(item.side).toBeTypeOf('string');
                expect(item.hash).toBeTypeOf('string');
                expect(item.best_bid).toBeTypeOf('string');
                expect(item.best_ask).toBeTypeOf('string');
            });
        });
    });

    it('should have EXACTLY the specified fields in PriceChangeItem (no extra, no missing)', () => {
        priceChange.forEach((pc: PriceChangeEvent, pcIndex: number) => {
            pc.price_changes.forEach((item: PriceChangeItem, itemIndex: number) => {
                const error = validateExactFields(item as unknown as Record<string, unknown>, EXPECTED_FIELDS.PriceChangeItem, `PriceChangeEvent[${pcIndex}].price_changes[${itemIndex}]`);
                if (error) {
                    throw new Error(error);
                }
            });
        });
    });
})
