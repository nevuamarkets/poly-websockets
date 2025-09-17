import {
  WSSubscriptionManager as PolymarketStream,
  WebSocketHandlers,
  PolymarketPriceUpdateEvent,
  PriceChangeEvent,
  BookEvent,
  LastTradePriceEvent,
} from '../src'; // '@nevuamarkets/poly-websockets';

// Example of basic usage with price updates
const handlers: WebSocketHandlers = {
  onPolymarketPriceUpdate: async (events: PolymarketPriceUpdateEvent[]) => {
    for (const event of events) {
      const obj = {
        event: "price_update",
        asset_id: event.asset_id,
        triggeringEvent: event.triggeringEvent.event_type,
        price: event.price,
        midpoint: event.midpoint,
        spread: event.spread,
      }
      console.log(JSON.stringify(obj, null, 2));
    }
  },

  onPriceChange: async (events: PriceChangeEvent[]) => {
    for (const event of events) {
      console.log('price_change event:');
      console.log('  Market:', event.market);
      console.log('  Timestamp:', event.timestamp);
      console.log('  Price changes:');
      for (const change of event.price_changes) {
        console.log(`    Asset ${change.asset_id}:`);
        console.log(`      ${change.side} ${change.size} @ ${change.price}`);
        console.log(`      Best bid: ${change.best_bid}, Best ask: ${change.best_ask}`);
        console.log(`      Hash: ${change.hash}`);
      }
    }
  },

  onBook: async (events: BookEvent[]) => {
    for (const event of events) {
      console.log('book event', JSON.stringify(event, null, 2))
    }
  },

  onLastTradePrice: async (events: LastTradePriceEvent[]) => {
    for (const event of events) {
      //console.log('last_trade_price event', event)
    }
  },

  onWSClose: async (groupId: string, code: number, reason: string) => {
    console.log(`WebSocket closed for group ${groupId} with code ${code} and reason ${reason}`);
  },
  onWSOpen: async (groupId: string, assetIds: string[]) => {
    console.log(`WebSocket opened for group ${groupId} with ${assetIds.length} assets`);
  },
  onError: async (error: Error) => {
    console.error('Error handler', error)
  }
};

// Create a subscription manager
const manager = new PolymarketStream(handlers);

(async () => {
  // Get top 10 markets by volume
  const response = await fetch('https://gamma-api.polymarket.com/markets?limit=10&order=volumeNum&ascending=false&active=true&closed=false', {method: 'GET'})
  const data = await response.json() as any[]

  // Filter out markets that don't have a CLob token ID
  const assetIds = data.filter((market) => market.clobTokenIds.length > 0).map((market) => JSON.parse(market.clobTokenIds)[0]);
  console.log('assetIds', assetIds)

  await manager.addSubscriptions(assetIds);

  setTimeout(() => {
    manager.removeSubscriptions([assetIds[0]]);
  }, 5000);

})();
