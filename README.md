# Poly-WebSockets

A TypeScript library for real-time Polymarket WebSocket price alerts with automatic connection management and intelligent reconnection handling.

## Installation

```bash
npm install poly-websockets
```

## Features

- 🔄 **Automatic Connection Management**: Handles WebSocket connections, reconnections, and cleanup for grouped subscriptions
- 📊 **Real-time Price Updates**: Get live price data, order book updates, and trade events from Polymarket
- 🎯 **Smart Price Logic**: Implements Polymarket's price calculation logic (midpoint vs last trade price based on spread)
- 🚦 **Rate Limiting**: Built-in rate limiting to respect Polymarket API limits
- 🔗 **Group Management**: Efficiently manages multiple asset subscriptions across connection groups
- 💪 **TypeScript Support**: Full TypeScript definitions for all events and handlers

## Quick Start

```typescript
import { WSSubscriptionManager, WebSocketHandlers } from 'poly-websockets';

// Define your event handlers
const handlers: WebSocketHandlers = {
  onPolymarketPriceUpdate: async (events) => {
    events.forEach(event => {
      console.log(`Price update for ${event.asset_id}: $${event.price}`);
    });
  },
  onError: async (error) => {
    console.error('WebSocket error:', error);
  }
};

// Create the subscription manager
const manager = new WSSubscriptionManager(handlers);

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
  - `burstLimiter?: Bottleneck` - Custom rate limiter instance

**Connection Management:**
The WSSubscriptionManager automatically:
- Groups asset subscriptions into efficient WebSocket connections
- Handles reconnections when connections drop
- Manages connection lifecycle and cleanup
- Balances load across multiple WebSocket groups

#### Methods

##### `addSubscriptions(assetIds: string[]): Promise<void>`

Adds new asset subscriptions. The manager will:
- Filter out already subscribed assets
- Find available connection groups or create new ones
- Establish WebSocket connections as needed

##### `removeSubscriptions(assetIds: string[]): Promise<void>`

Removes asset subscriptions. Connections are kept alive to avoid missing events, and unused groups are cleaned up during the next reconnection cycle.

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
  
  // Aggregated price update event (recommended for most use cases)
  onPolymarketPriceUpdate?: (events: PolymarketPriceUpdateEvent[]) => Promise<void>;
  
  // Connection lifecycle events
  onWSOpen?: (groupId: string, assetIds: string[]) => Promise<void>;
  onWSClose?: (groupId: string, code: number, reason: string) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
}
```

#### Key Event Types

**PolymarketPriceUpdateEvent** (Recommended)
- Aggregated price update following Polymarket's display logic
- Uses midpoint when spread < $0.10, otherwise uses last trade price
- Includes full order book context

**BookEvent**
- Complete order book snapshots with bids and asks
- Triggered on significant order book changes

**PriceChangeEvent**
- Individual price level changes in the order book
- More granular than book events

**LastTradePriceEvent**
- Real-time trade executions
- Includes trade side, size, and price

## Advanced Usage

### Custom Rate Limiting

```typescript
import Bottleneck from 'bottleneck';

const customLimiter = new Bottleneck({
  reservoir: 3,
  reservoirRefreshAmount: 3,
  reservoirRefreshInterval: 1000,
  maxConcurrent: 3
});

const manager = new WSSubscriptionManager(handlers, {
  burstLimiter: customLimiter
});
```

### Connection Group Configuration

```typescript
const manager = new WSSubscriptionManager(handlers, {
  maxMarketsPerWS: 50,  // Smaller groups for more granular control
  reconnectAndCleanupIntervalMs: 5000  // More frequent reconnection checks
});
```

### Handling All Event Types

```typescript
const comprehensiveHandlers: WebSocketHandlers = {
  onPolymarketPriceUpdate: async (events) => {
    // Primary price updates for UI display
    events.forEach(event => {
      updatePriceDisplay(event.asset_id, event.price);
    });
  },
  
  onBook: async (events) => {
    // Order book depth for trading interfaces
    events.forEach(event => {
      updateOrderBook(event.asset_id, event.bids, event.asks);
    });
  },
  
  onLastTradePrice: async (events) => {
    // Real-time trade feed
    events.forEach(event => {
      logTrade(event.asset_id, event.price, event.size, event.side);
    });
  },
  
  onWSOpen: async (groupId, assetIds) => {
    console.log(`Connected group ${groupId} with ${assetIds.length} assets`);
  },
  
  onWSClose: async (groupId, code, reason) => {
    console.log(`Disconnected group ${groupId}: ${reason} (${code})`);
  },
  
  onError: async (error) => {
    console.error('WebSocket error:', error);
    // Implement your error handling/alerting logic
  }
};
```

## Examples

Check the [examples](./examples) folder for complete working examples including:
- Basic price monitoring
- Market data aggregation  
- Real-time trading interfaces

## Error Handling

The library includes comprehensive error handling:
- Automatic reconnection on connection drops
- Rate limiting to prevent API blocking
- Graceful handling of malformed messages
- User-defined error callbacks for custom handling

## Rate Limits

Respects Polymarket's API rate limits:
- Default: 5 requests per second burst limit
- Configurable through custom Bottleneck instances
- Automatic backoff on rate limit hits

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
