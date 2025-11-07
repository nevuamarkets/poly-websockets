/// <reference types="vitest" />
import { beforeEach, describe, it, expect } from "vitest";
import { WSSubscriptionManager } from '../../src/WSSubscriptionManager'
import { BookEvent, LastTradePriceEvent, PriceChangeEvent, TickSizeChangeEvent, WebSocketHandlers } from '../../src/types/PolymarketWebSocket'

const marketsQty = '5';
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
async function createConnectionWithType(tokenIdsArray:string[], type: string): Promise<BookEvent[]|LastTradePriceEvent[]|TickSizeChangeEvent[]|PriceChangeEvent[]|boolean|undefined> {
    tokenIdsArray = await getTopMarketsByVolume(marketsQty);
    let stream:WSSubscriptionManager;
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
        return data;
    }catch(e){
        console.log("Error while creating connection: ", e)
    }
    

}

describe("onBook", () => {
    let tokenIdsArray;
    let book: any;

    beforeEach(async () => {
        tokenIdsArray = await getTopMarketsByVolume(marketsQty)
        book = await createConnectionWithType(tokenIdsArray, "onBook")
    });

    it('should receive the orderbook', async() => {
        expect(book).toBeDefined()
        console.log(book)
    }, 5000)

})
