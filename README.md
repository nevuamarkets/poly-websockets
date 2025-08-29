# Poly-WebSockets

A TypeScript library for **real-time Polymarket market price alerts and user event tracking** over **Websocket** with **automatic reconnections** and **easy subscription management**.

Powering [Nevua Markets](https://nevua.markets)

## Installation

```bash
npm install @nevuamarkets/poly-websockets
```

## Features

- 📊 **Real-time Market Updates**: Get `book` , `price_change`, `tick_size_change` and `last_trade_price` real-time market events from Polymarket WSS
- 👤 **Real-time User Updates**: Authenticated access to your `order` and `trade` events for account monitoring
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

// Or create with custom options, including initialDump
const managerWithOptions = new WSSubscriptionManager({
  // ... handlers
}, {
  maxMarketsPerWS: 50,
  initialDump: false // Don't receive initial order book state
});

// Subscribe to assets
await manager.addSubscriptions(['asset-id-1', 'asset-id-2']);

// Remove subscriptions
await manager.removeSubscriptions(['asset-id-1']);

// Clear all subscriptions and connections
await manager.clearState();
```

## User Channel (Orders & Trades)

The library also supports Polymarket's **user channel** for authenticated real-time updates about your orders and trades.

```typescript
import {
  UserWSSubscriptionManager,
  UserWebSocketHandlers,
  OrderEvent,
  TradeEvent,
  Side,
  OrderType,
  TradeStatus
} from '@nevuamarkets/poly-websockets';

// Your Polymarket API credentials
const auth = {
  apiKey: 'your-api-key',
  secret: 'your-secret', 
  passphrase: 'your-passphrase'
};

// Create handlers for user events
const userHandlers: UserWebSocketHandlers = {
  onOrder: async (events: OrderEvent[]) => {
    for (const event of events) {
      console.log('Order update:', {
        orderId: event.id,
        market: event.market,
        side: event.side,
        status: event.status,
        price: event.price,
        originalSize: event.original_size
      });
    }
  },
  
  onTrade: async (events: TradeEvent[]) => {
    for (const event of events) {
      console.log('Trade executed:', {
        tradeId: event.trade_id,
        orderId: event.order_id,
        side: event.side,
        price: event.price,
        size: event.size,
        fee: event.fee
      });
    }
  },
  
  onError: async (error: Error) => {
    console.error('User channel error:', error.message);
  }
};

// Create the user subscription manager
const userManager = new UserWSSubscriptionManager(userHandlers, {
  auth,
  maxMarketsPerWS: 50
});

// Subscribe to user events for specific markets (condition IDs)
await userManager.addSubscriptions(['condition-id-1', 'condition-id-2']);

// Or subscribe to all user events without filtering
// await userManager.addSubscriptions(); // No arguments for all events

// Clean up when done
await userManager.clearState();
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
  - `maxMarketsPerWS?: number` - Maximum assets per WebSocket connection (default: unlimited, as Polymarket removed the 100 token limit)
  - `reconnectAndCleanupIntervalMs?: number` - Interval for reconnection attempts (default: 10s)
  - `burstLimiter?: Bottleneck` - Custom rate limiter instance. If none is provided, one will be created and used internally in the component.
  - `initialDump?: boolean` - Whether to receive the initial order book state when subscribing to tokens (default: true)

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

### UserWSSubscriptionManager

The main class for managing authenticated user channel WebSocket connections for order and trade events.

#### Constructor

```typescript
new UserWSSubscriptionManager(handlers: UserWebSocketHandlers, options: UserSubscriptionManagerOptions)
```

**Parameters:**
- `handlers` - Event handlers for user events (orders, trades)
- `options` - Configuration object:
  - `auth: ApiCredentials` - **Required** API credentials for authentication
  - `maxMarketsPerWS?: number` - Maximum markets per WebSocket connection (default: unlimited, as Polymarket removed the 100 token limit)
  - `reconnectAndCleanupIntervalMs?: number` - Interval for reconnection attempts (default: 10s)
  - `burstLimiter?: Bottleneck` - Custom rate limiter instance

#### Methods

##### `addSubscriptions(marketIds?: string[]): Promise<void>`

Adds subscriptions for user events on specific markets (condition IDs).

- When called with specific market IDs: Subscribes to user events only for those markets
- When called with empty array or no arguments: Subscribes to **all** user events without filtering

```typescript
// Subscribe to specific markets
await userManager.addSubscriptions(['condition-id-1', 'condition-id-2']);

// Subscribe to all user events (no filtering)
await userManager.addSubscriptions(); // No arguments
await userManager.addSubscriptions([]); // Or empty array
```

##### `removeSubscriptions(marketIds: string[]): Promise<void>`

Removes market subscriptions from user event monitoring.

##### `clearState(): Promise<void>`

Clears all subscriptions and closes all user channel connections.

### UserWebSocketHandlers

Interface defining event handlers for user channel events.

```typescript
interface UserWebSocketHandlers {
  onOrder?: (events: OrderEvent[]) => Promise<void>;
  onTrade?: (events: TradeEvent[]) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
  onWSClose?: (groupId: string, code: number, reason: string) => Promise<void>;
  onWSOpen?: (groupId: string, marketIds: string[]) => Promise<void>;
}
```

### ApiCredentials

Authentication credentials for user channel access.

```typescript
interface ApiCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}
```

### User Event Types

#### OrderEvent
Order status updates from your account:
```typescript
interface OrderEvent {
  asset_id: string;
  associate_trades: string[] | null;
  event_type: 'order';
  id: string;
  market: string;
  order_owner: string;
  original_size: string;
  outcome: string;
  owner: string;
  price: string;
  side: Side;
  size_matched: string;
  timestamp: string;
  type: OrderType;
}
```

#### TradeEvent
Trade execution notifications:
```typescript
interface TradeEvent {
  asset_id: string;
  event_type: 'trade';
  id: string;
  last_update: string;
  maker_orders: MakerOrder[];
  market: string;
  matchtime: string;
  outcome: string;
  owner: string;
  price: string;
  side: Side;
  size: string;
  status: TradeStatus;
  taker_order_id: string;
  timestamp: string;
  trade_owner: string;
  type: 'TRADE';
}
```

#### Supporting Types

**MakerOrder**
```typescript
interface MakerOrder {
  asset_id: string;
  matched_amount: string;
  order_id: string;
  outcome: string;
  owner: string;
  price: string;
}
```

**Enums**
```typescript
enum Side {
  BUY = 'BUY',
  SELL = 'SELL'
}

enum TradeStatus {
  MATCHED = 'MATCHED',
  MINED = 'MINED',
  CONFIRMED = 'CONFIRMED',
  RETRYING = 'RETRYING',
  FAILED = 'FAILED'
}

enum OrderType {
  PLACEMENT = 'PLACEMENT',
  UPDATE = 'UPDATE',
  CANCELLATION = 'CANCELLATION'
}
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
