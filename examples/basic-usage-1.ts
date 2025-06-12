import util from 'util';
import {
    WSSubscriptionManager as PolymarketStream,
    PolymarketPriceUpdateEvent,
  } from '@nevuamarkets/poly-websockets';
  
  const markets: Map<string, string> = new Map();
  
  (async () => {
    /* 1. Fetch top 10 markets by volume from Polymarket API */
    const marketsUrl = 'https://gamma-api.polymarket.com/markets'
    const queryParams = new URLSearchParams({
      limit: '10', order: 'volumeNum', ascending: 'false', active: 'true', closed: 'false'
    })
    const response = await fetch(`${marketsUrl}?${queryParams.toString()}`)
    const data = await response.json() as any[]
    data.forEach((market) => markets.set(JSON.parse(market.clobTokenIds)[0], market.question))
  
    /* 2. Subscribe to events and log price updates */
    const stream = new PolymarketStream({
      onPolymarketPriceUpdate: async (events: PolymarketPriceUpdateEvent[]) => {
        
        events.forEach(event => console.log(util.inspect({ 
          question: markets.get(event.asset_id),
          chance: (parseFloat(event.price) * 100).toFixed(2) + ' %',
        }, { colors: true, depth: null, compact: false })));
      },
      onError: async (error: Error) => console.error('Error:', error.message)
    });

    await stream.addSubscriptions(Array.from(markets.keys()));
  })();
  