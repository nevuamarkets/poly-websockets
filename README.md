# Poly-WebSockets

A TypeScript library for **real-time Polymarket market price alerts** over **Websocket** with **automatic reconnections** and **easy subscription management**.

Powering [Nevua Markets](https://nevua.markets)

## Installation

```bash
npm install @nevuamarkets/poly-websockets
```

## Features

- 📊 **Real-time Market Updates**: Get `book` , `price_change`, `tick_size_change` and `last_trade_price` real-time market events from Polymarket WSS
- 🎯 **Derived Future Price Event**: Implements Polymarket's [price calculation logic](https://docs.polymarket.com/polymarket-learn/trading/how-are-prices-calculated#future-price) (midpoint vs last trade price based on spread)
- 🔗 **Group Management**: Efficiently manages multiple asset subscriptions across connection groups **without losing events** when subscribing / unsubscribing assets.
- 🔄 **Automatic Connection Management**: Handles WebSocket connections, reconnections, and cleanup for grouped assetId (i.e. clobTokenId) subscriptions
- 🚦 **Rate Limiting**: Built-in rate limiting to respect Polymarket API limits
- 💪 **TypeScript Support**: Full TypeScript definitions for all events and handlers

## Quick Start

```typescript
import {
  WSSubscriptionManager,
  WebSocketHandlers
  } from '@nevuamarkets/poly-websockets';

// Create the subscription manager with your own handlers
const manager = new WSSubscriptionManager({
  onBook: async (events: BookEvent[]) => {
    for (const event of events) {
      console.log('book event', JSON.stringify(event, null, 2))
    }
  },
  onPriceChange: async (events: PriceChangeEvent[]) => {
    for (const event of events) {
      console.log('price change event', JSON.stringify(event, null, 2))
    }
  }
});

// Subscribe to assets
await manager.addSubscriptions(['asset-id-1', 'asset-id-2']);

// Remove subscriptions
await manager.removeSubscriptions(['asset-id-1']);

// Clear all subscriptions and connections
await manager.clearState();
```

## API Reference

### WSSubscriptionManager

The main class that manages WebSocket connections and subscriptions.

#### Constructor

```typescript
new WSSubscriptionManager(handlers: WebSocketHandlers, options?: SubscriptionManagerOptions)
```

**Parameters:**
- `handlers` - Event handlers for different WebSocket events
- `options` - Optional configuration object:
  - `maxMarketsPerWS?: number` - Maximum assets per WebSocket connection (default: 100)
  - `reconnectAndCleanupIntervalMs?: number` - Interval for reconnection attempts (default: 10s)
  - `burstLimiter?: Bottleneck` - Custom rate limiter instance. If none is provided, one will be created and used internally in the component.

#### Methods

##### `addSubscriptions(assetIds: string[]): Promise<void>`

Adds new asset subscriptions. The manager will:
- Filter out already subscribed assets
- Find available connection groups or create new ones
- Establish WebSocket connections as needed

##### `removeSubscriptions(assetIds: string[]): Promise<void>`

Removes asset subscriptions. **Connections are kept alive to avoid missing events**, and unused groups are cleaned up during the next reconnection cycle.

##### `clearState(): Promise<void>`

Clears all subscriptions and state:
- Removes all asset subscriptions
- Closes all WebSocket connections
- Clears the internal order book cache

### WebSocketHandlers

Interface defining event handlers for different WebSocket events.

```typescript
interface WebSocketHandlers {
  // Core Polymarket WebSocket events
  onBook?: (events: BookEvent[]) => Promise<void>;
  onLastTradePrice?: (events: LastTradePriceEvent[]) => Promise<void>;
  onPriceChange?: (events: PriceChangeEvent[]) => Promise<void>;
  onTickSizeChange?: (events: TickSizeChangeEvent[]) => Promise<void>;
  
  // Derived polymarket price update event
  onPolymarketPriceUpdate?: (events: PolymarketPriceUpdateEvent[]) => Promise<void>;
  
  // Connection lifecycle events
  onWSOpen?: (groupId: string, assetIds: string[]) => Promise<void>;
  onWSClose?: (groupId: string, code: number, reason: string) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
}
```

#### Key Event Types

**BookEvent**
- See // https://docs.polymarket.com/developers/CLOB/websocket/market-channel#book-message

**PriceChangeEvent**
- See https://docs.polymarket.com/developers/CLOB/websocket/market-channel#price-change-message

**onTickSizeChange**
- See https://docs.polymarket.com/developers/CLOB/websocket/market-channel#tick-size-change-message

**LastTradePriceEvent**
- Currently undocumented, but is emitted when a trade occurs

**PolymarketPriceUpdateEvent**
- Derived price update following Polymarket's display logic
- Uses midpoint when spread <= $0.10, otherwise uses last trade price
- Includes full order book context

### Custom Rate Limiting

```typescript
import Bottleneck from 'bottleneck';

const customLimiter = new Bottleneck({
  reservoir: 10,
  reservoirRefreshAmount: 10,
  reservoirRefreshInterval: 1000,
  maxConcurrent: 10
});

const manager = new WSSubscriptionManager(handlers, {
  burstLimiter: customLimiter
});
```

## Examples

Check the [examples](./examples) folder for complete working examples

## Error Handling

The library includes error handling:
- Automatic reconnection on connection drops
- User-defined error callbacks for custom handling

## Rate Limits

Respects Polymarket's API rate limits:
- Default: 5 requests per second burst limit
- Configurable through custom Bottleneck instances

## License

AGPL-3

## Testing

```bash
npm test
```

## TypeScript Support

Full TypeScript definitions included.

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The author(s) are not responsible for:

- Any financial losses incurred from using this software
- Trading decisions made based on the data provided
- Bugs, errors, or inaccuracies in the data
- System failures or downtime
- Any other damages arising from the use of this software

Use at your own risk. Always verify data independently and never rely solely on automated systems for trading decisions.
