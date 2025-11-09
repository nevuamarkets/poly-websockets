/// <reference types="vitest" />
import { beforeEach, describe, it, expect } from "vitest";
import { WSSubscriptionManager } from '../../src/WSSubscriptionManager'
import { BookEvent, LastTradePriceEvent, PriceChangeEvent, TickSizeChangeEvent, WebSocketHandlers } from '../../src/types/PolymarketWebSocket'

const marketsQty = '50';
const marketsUrl = 'https://gamma-api.polymarket.com/markets'

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
 * Creates a connection and returns the first value that it receives,
 * except onOpen event that returns true once the connection is established
 * @param {string[]} tokenIdsArray an array of markets tokenIds
 * @param {string} type the type of handlers (onOpen, onBook, ...)
 * @returns {Promise<BookEvent[]|LastTradePriceEvent[]|TickSizeChangeEvent[]|PriceChangeEvent[]|boolean|undefined>} 
 * Boolean for onOpen,
 * Undefined if it fails,
 * Events for the rest
 */
async function createConnectionWithType(tokenIdsArray:string[], type: string):
Promise<{
    data: Promise<BookEvent[] | LastTradePriceEvent[] | TickSizeChangeEvent[] | PriceChangeEvent[] | boolean | undefined>,
    stream: WSSubscriptionManager | undefined} | undefined>
{
    let stream: WSSubscriptionManager | undefined;
    try{
        const data = new Promise<BookEvent[]|LastTradePriceEvent[]|TickSizeChangeEvent[]|PriceChangeEvent[]|boolean>((resolve) => {
            stream = new WSSubscriptionManager({
                onBook: async (events: BookEvent[]) => {
                    if (type == "onBook") {
                        resolve(events);
                    }
                },
                onLastTradePrice: async (events:LastTradePriceEvent[]) => {
                    if (type == "onLastTradePrice"){
                        resolve(events)
                    }
                },
                onTickSizeChange: async (events:TickSizeChangeEvent[]) => {
                    if (type == "onTickSizeChange"){
                        resolve(events)
                    }
                },
                onPriceChange: async (events:PriceChangeEvent[]) => {
                    if (type == "onPriceChange"){
                        resolve(events)
                    }
                },
                onWSOpen: async () => {
                    if (type == "onWSOpen"){
                        resolve(true);
                    }
                },
                onError: async (error: Error) => console.error('Error:', error.message)
            });

            stream.addSubscriptions(tokenIdsArray);
        })
        return {data: data, stream: stream};

    }catch(e){
        console.log("Error while creating connection: ", e)
        return undefined;
    }


}

describe("onBook", () => {
    let tokenIdsArray;
    let books: any;
    let stream: WSSubscriptionManager | undefined;

    beforeEach(async () => {
        tokenIdsArray = await getTopMarketsByVolume(marketsQty)
        const result = await createConnectionWithType(tokenIdsArray, "onBook");
        if (result) {
            books = await result.data;
            stream = result.stream;
        }
        stream?.clearState()
    });

    it('should receive the orderbook', async() => {
        expect(books).toBeDefined()
    })

    it('should have all fileds', () => {
        books.forEach((book:BookEvent) => {
            expect(book.market).toBeTypeOf('string')
            expect(book.asset_id).toBeTypeOf('string')
            expect(book.timestamp).toBeTypeOf('string')
            expect(book.hash).toBeTypeOf('string')
            expect(Array.isArray(book.bids)).toBe(true)
            expect(Array.isArray(book.asks)).toBe(true)
            expect(book.event_type).toBe('book')
        });
    });

    it('should have only specified fields', () => {
        books.forEach((book: BookEvent) => {
            const expectedKeys = ['market', 'asset_id', 'timestamp', 'hash', 'bids', 'asks', 'event_type', 'last_trade_price'];
            expect(Object.keys(book).sort()).toEqual(expectedKeys.sort());
        });
    });
})

// Might time out with low markets quantity
describe("onLastTradePrice", () => {
    let tokenIdsArray;
    let lastTradePrice: any;
    let stream: WSSubscriptionManager | undefined;

    beforeEach(async () => {
        tokenIdsArray = await getTopMarketsByVolume(marketsQty)
        const result = await createConnectionWithType(tokenIdsArray, "onLastTradePrice");
        if (result) {
            lastTradePrice = await result.data;
            stream = result.stream;
            console.log(result.data)
        }
        stream?.clearState()
    });

    it('should receive last trade price object', async() => {
        expect(lastTradePrice).toBeDefined()
    })

    it('should have all expected fileds', () => {
        lastTradePrice.forEach((ltp:LastTradePriceEvent) => {
            expect(ltp.asset_id).toBeTypeOf('string')
            expect(ltp.event_type).toBe('last_trade_price')
            expect(ltp.fee_rate_bps).toBeTypeOf('string')
            expect(ltp.market).toBeTypeOf('string')
            expect(ltp.price).toBeTypeOf('string')
            expect(ltp.side).toBeTypeOf('string')
            expect(ltp.size).toBeTypeOf('string')
            expect(ltp.timestamp).toBeTypeOf('string')
        });
    });

    it('should have only specified fields', () => {
        lastTradePrice.forEach((ltp: BookEvent) => {
            const expectedKeys = ['market', 'asset_id', 'timestamp', 'fee_rate_bps', 'price', 'side', 'event_type', 'size', 'transaction_hash'];
            expect(Object.keys(ltp).sort()).toEqual(expectedKeys.sort());
        });
    });
})

describe("onPriceChange", () => {
    let tokenIdsArray;
    let lastTradePrice: any;
    let stream: WSSubscriptionManager | undefined;

    beforeEach(async () => {
        tokenIdsArray = await getTopMarketsByVolume(marketsQty)
        const result = await createConnectionWithType(tokenIdsArray, "onPriceChange");
        if (result) {
            lastTradePrice = await result.data;
            stream = result.stream;
            console.log(result)
        }
        stream?.clearState()
    });



})
