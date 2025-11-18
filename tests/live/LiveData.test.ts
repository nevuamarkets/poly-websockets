/// <reference types='vitest' />
import { describe, it, expect, beforeAll } from 'vitest';
import { WSSubscriptionManager } from '../../src/WSSubscriptionManager'
import { BookEvent, LastTradePriceEvent, PriceChangeEvent, PriceChangeItem, TickSizeChangeEvent, WebSocketHandlers } from '../../src/types/PolymarketWebSocket'

const marketsQty = '100';
const marketsUrl = 'https://gamma-api.polymarket.com/markets'
type allEvents = {
    book: BookEvent[],
    lastTradePrice: LastTradePriceEvent[];
    priceChange: PriceChangeEvent[];
}

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
    })

    it('should have all fileds', () => {
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

    it('should have only specified fields', () => {
        books.forEach((book: BookEvent) => {
            const expectedKeys = ['market', 'asset_id', 'timestamp', 'hash', 'bids', 'asks', 'event_type'];
            expect(Object.keys(book).sort()).toEqual(expectedKeys.sort());
        });
    });
})

describe('onLastTradePrice', () => {
    let lastTradePrice: any;

    beforeAll(async () => {
        lastTradePrice = data.lastTradePrice
    });

    it('should receive last trade price event', async() => {
        expect(lastTradePrice).toBeDefined();
    })

    it('should have all expected fields', () => {
        lastTradePrice.forEach((ltp:LastTradePriceEvent) => {
            expect(ltp.asset_id).toBeTypeOf('string');
            expect(ltp.event_type).toBe('last_trade_price');
            expect(ltp.fee_rate_bps).toBeTypeOf('string');
            expect(ltp.market).toBeTypeOf('string');
            expect(ltp.price).toBeTypeOf('string');
            expect(ltp.side).toBeTypeOf('string');
            expect(ltp.size).toBeTypeOf('string');
            expect(ltp.timestamp).toBeTypeOf('string');
        });
    });

    it('should have only specified fields', () => {
        lastTradePrice.forEach((ltp: BookEvent) => {
            const expectedKeys = ['market', 'asset_id', 'timestamp', 'fee_rate_bps', 'price', 'side', 'event_type', 'size', 'transaction_hash'];
            expect(Object.keys(ltp).sort()).toEqual(expectedKeys.sort());
        });
    });
})

describe('onPriceChange', () => {
    let priceChange: any;

    beforeAll(async () => {
        priceChange = data.priceChange;
    });

    it('should receive onPriceChange event', async() => {
        expect(priceChange).toBeDefined();
    })
    
    it('should have all expected fileds', () => {
        priceChange.forEach((pc:PriceChangeEvent) => {
            expect(pc.market).toBeTypeOf('string');
            expect(pc.timestamp).toBeTypeOf('string');
            expect(pc.event_type).toBe('price_change');
            expect(Array.isArray(pc.price_changes)).toBe(true);
        });
    });

    it('should have all expected fileds in price_changes array', () => {
        priceChange[0].price_changes.forEach((pc:PriceChangeItem) => {
            expect(pc.asset_id).toBeTypeOf('string');
            expect(pc.price).toBeTypeOf('string');
            expect(pc.size).toBeTypeOf('string');
            expect(pc.side).toBeTypeOf('string');
            expect(pc.hash).toBeTypeOf('string');
            expect(pc.best_bid).toBeTypeOf('string');
            expect(pc.best_ask).toBeTypeOf('string');
        });
    });
})
