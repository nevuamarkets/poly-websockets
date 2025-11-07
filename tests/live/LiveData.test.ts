/// <reference types="vitest" />
import { beforeEach, describe, it, expect } from "vitest";
import { WSSubscriptionManager } from '../../src/WSSubscriptionManager'
import { BookEvent, LastTradePriceEvent, PriceChangeEvent, TickSizeChangeEvent, WebSocketHandlers } from '../../src/types/PolymarketWebSocket'
import { WebSocketStatus } from "../../src/types/WebSocketSubscriptions";

const marketsQty = '5';
const bookEndpoint = 'https://clob.polymarket.com/book?token_id='
const marketsUrl = 'https://gamma-api.polymarket.com/markets'


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

describe("subscription check", () => {

    beforeEach(async () => {

    });

    it('should have the book', async() => {
        const tokenIdsArray = await getTopMarketsByVolume(marketsQty)
        console.log(tokenIdsArray)
        const result = await createConnectionWithType(tokenIdsArray, "onBook")
        console.log(result)
    }, 5000)

})
