# Poly-WebSockets

A TypeScript library for **real-time Polymarket market data** over **WebSocket** with **automatic reconnections** and **easy subscription management**.

Powering [Nevua Markets](https://nevua.markets)

## Installation

```bash
npm install @nevuamarkets/poly-websockets
```

## Features

- 📊 **Real-time Market Updates**: Get `book`, `price_change`, `tick_size_change` and `last_trade_price` events from Polymarket WebSocket
- 🎯 **Derived Price Event**: Implements Polymarket's [price calculation logic](https://docs.polymarket.com/polymarket-learn/trading/how-are-prices-calculated#future-price) (midpoint vs last trade price based on spread)
- 🔗 **Dynamic Subscriptions**: Subscribe and unsubscribe to assets without reconnecting
- 🔄 **Automatic Reconnection**: Handles connection drops with automatic reconnection
- 💪 **TypeScript Support**: Full TypeScript definitions for all events and handlers
- 🔒 **Independent Instances**: Each manager instance is fully isolated with its own WebSocket connection

## Quick Start

```typescript
import { WSSubscriptionManager } from '@nevuamarkets/poly-websockets';

const manager = new WSSubscriptionManager({
  onBook: async (events) => {
    console.log('Book events:', events);
  },
  onPriceChange: async (events) => {
    console.log('Price change events:', events);
  },
  onPolymarketPriceUpdate: async (events) => {
    // Derived price following Polymarket's display logic
    console.log('Price updates:', events);
  },
  onError: async (error) => {
    console.error('Error:', error.message);
  }
});

// Subscribe to assets
await manager.addSubscriptions(['asset-id-1', 'asset-id-2']);

// Get monitored assets
console.log('Monitored:', manager.getAssetIds());

// Remove subscriptions
await manager.removeSubscriptions(['asset-id-1']);

// Clear all subscriptions and close connection
await manager.clearState();
```

## API Reference

### WSSubscriptionManager

#### Constructor

```typescript
new WSSubscriptionManager(handlers: WebSocketHandlers, options?: SubscriptionManagerOptions)
```

**Parameters:**
- `handlers` - Event handlers for WebSocket events
- `options` - Optional configuration:
  - `reconnectAndCleanupIntervalMs?: number` - Reconnection check interval (default: 5000ms)
  - `pendingFlushIntervalMs?: number` - How often to flush pending subscriptions (default: 100ms)

#### Methods

| Method | Description |
|--------|-------------|
| `addSubscriptions(assetIds: string[])` | Add assets to monitor |
| `removeSubscriptions(assetIds: string[])` | Stop monitoring assets |
| `getAssetIds(): string[]` | Get all monitored asset IDs (subscribed + pending) |
| `getStatistics()` | Get connection and subscription statistics |
| `clearState()` | Clear all subscriptions and close connection |

#### Statistics Object

```typescript
manager.getStatistics() // Returns:
{
  openWebSockets: number;           // 1 if connected, 0 otherwise
  assetIds: number;                 // Total monitored assets
  pendingSubscribeCount: number;    // Assets waiting to be subscribed
  pendingUnsubscribeCount: number;  // Assets waiting to be unsubscribed
}
```

### WebSocketHandlers

```typescript
interface WebSocketHandlers {
  // Polymarket WebSocket events
  onBook?: (events: BookEvent[]) => Promise<void>;
  onLastTradePrice?: (events: LastTradePriceEvent[]) => Promise<void>;
  onPriceChange?: (events: PriceChangeEvent[]) => Promise<void>;
  onTickSizeChange?: (events: TickSizeChangeEvent[]) => Promise<void>;
  
  // Derived price update (implements Polymarket's display logic)
  onPolymarketPriceUpdate?: (events: PolymarketPriceUpdateEvent[]) => Promise<void>;
  
  // Connection events
  onWSOpen?: (managerId: string, pendingAssetIds: string[]) => Promise<void>;
  onWSClose?: (managerId: string, code: number, reason: string) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
}
```

### Event Types

| Event | Description |
|-------|-------------|
| `BookEvent` | Full order book snapshot ([docs](https://docs.polymarket.com/developers/CLOB/websocket/market-channel#book-message)) |
| `PriceChangeEvent` | Order book price level changes ([docs](https://docs.polymarket.com/developers/CLOB/websocket/market-channel#price-change-message)) |
| `TickSizeChangeEvent` | Tick size changes ([docs](https://docs.polymarket.com/developers/CLOB/websocket/market-channel#tick-size-change-message)) |
| `LastTradePriceEvent` | Trade executions |
| `PolymarketPriceUpdateEvent` | Derived price using Polymarket's display logic |

## Multiple Independent Connections

Each `WSSubscriptionManager` instance maintains its own WebSocket connection:

```typescript
// Two separate connections for different asset groups
const manager1 = new WSSubscriptionManager(handlers1);
const manager2 = new WSSubscriptionManager(handlers2);

await manager1.addSubscriptions(['asset-1', 'asset-2']);
await manager2.addSubscriptions(['asset-3', 'asset-4']);
```

## Examples

See the [examples](./examples) folder for complete working examples.

## Testing

```bash
npm test
```

## License

MIT

## Disclaimer

This software is provided "as is", without warranty of any kind. The author(s) are not responsible for any financial losses, trading decisions, bugs, or system failures. Use at your own risk.
