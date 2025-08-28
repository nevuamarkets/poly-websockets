/**
 * Enum for trade sides
 */
export enum Side {
    BUY = 'BUY',
    SELL = 'SELL'
}

/**
 * Enum for trade status
 */
export enum TradeStatus {
    MATCHED = 'MATCHED',
    MINED = 'MINED',
    CONFIRMED = 'CONFIRMED',
    RETRYING = 'RETRYING',
    FAILED = 'FAILED'
}

/**
 * Enum for order type
 */
export enum OrderType {
    PLACEMENT = 'PLACEMENT',
    UPDATE = 'UPDATE',
    CANCELLATION = 'CANCELLATION'
}

/**
 * Represents a single price level in the order book
 * @example
 * { price: "0.01", size: "510000" }
 */
export type PriceLevel = {
    price: string;
    size: string;
};

/**
 * Represents a price_change event from Polymarket WebSocket
 * @example
 * {
 *   asset_id: "39327269875426915204597944387916069897800289788920336317845465327697809453999",
 *   changes: [
 *     { price: "0.044", side: "SELL", size: "611" }
 *   ],
 *   event_type: "price_change",
 *   hash: "a0b7cadf869fc288dbbf65704996fe818cc97d6a",
 *   market: "0x5412ae25e97078f814157de948459d59c6221b4c4c495fdd57b536543ad36729",
 *   timestamp: "1749371014925"
 * }
 */
export type PriceChangeEvent = {
    asset_id: string;
    changes: { price: string; side: string; size: string }[];
    event_type: 'price_change';
    hash: string;
    market: string;
    timestamp: string;
};

/**
 * Represents a Polymarket book
 * @example
 * {
 *  bids: [
 *    { price: "0.01", size: "510000" },
 *    { price: "0.02", size: "3100" }
 *  ],
 *  asks: [
 *    { price: "0.99", size: "58.07" },
 *    { price: "0.97", size: "178.73" }
 * }
 */
export type Book = {
    bids: PriceLevel[];
    asks: PriceLevel[];
};

/**
 * Represents a book event from Polymarket WebSocket
 * @example
 * {
 *   market: "0xf83fb46dd70a4459fcc441a8511701c463374c5c3c250f585d74fda85ddfb7c9",
 *   asset_id: "101007741586870489619361069512452187353898396425142157315847015703471254508752",
 *   timestamp: "1740759191594",
 *   hash: "c0e51b1cfdbcb1b2aec58feaf7b01004019a89c6",
 *   bids: [
 *     { price: "0.01", size: "510000" },
 *     { price: "0.02", size: "3100" }
 *   ],
 *   asks: [
 *     { price: "0.99", size: "58.07" },
 *     { price: "0.97", size: "178.73" }
 *   ],
 *   event_type: "book"
 * }
 */
export type BookEvent = {
    market: string;
    asset_id: string;
    timestamp: string;
    hash: string;
    bids: PriceLevel[];
    asks: PriceLevel[];
    event_type: 'book';
};

/**
 * Represents a last trade price event from Polymarket WebSocket
 * @example
 * {
 *   asset_id: "101007741586870489619361069512452187353898396425142157315847015703471254508752",
 *   event_type: "last_trade_price",
 *   fee_rate_bps: "0",
 *   market: "0xf83fb46dd70a4459fcc441a8511701c463374c5c3c250f585d74fda85ddfb7c9",
 *   price: "0.12",
 *   side: "BUY",
 *   size: "8.333332",
 *   timestamp: "1740760245471"
 * }
 */
export type LastTradePriceEvent = {
    asset_id: string;
    event_type: 'last_trade_price';
    fee_rate_bps: string;
    market: string;
    price: string;
    side: Side;
    size: string;
    timestamp: string;
};

/**
 * Represents a tick size change event from Polymarket WebSocket
 * @example
 * {
 *   event_type: "tick_size_change",
 *   asset_id: "65818619657568813474341868652308942079804919287380422192892211131408793125422",
 *   market: "0xbd31dc8a20211944f6b70f31557f1001557b59905b7738480ca09bd4532f84af",
 *   old_tick_size: "0.01",
 *   new_tick_size: "0.001",
 *   timestamp: "100000000"
 * }
 */
export type TickSizeChangeEvent = {
    asset_id: string;
    event_type: 'tick_size_change';
    market: string;
    old_tick_size: string;
    new_tick_size: string;
    timestamp: string;
};

/**
 * Represents a maker order in a trade event
 * @example
 * {
 *   "asset_id": "52114319501245915516055106046884209969926127482827954674443846427813813222426",
 *   "matched_amount": "10",
 *   "order_id": "0xff354cd7ca7539dfa9c28d90943ab5779a4eac34b9b37a757d7b32bdfb11790b",
 *   "outcome": "YES",
 *   "owner": "9180014b-33c8-9240-a14b-bdca11c0a465",
 *   "price": "0.57"
 * }
 */
export interface MakerOrder {
    asset_id: string;
    matched_amount: string;
    order_id: string;
    outcome: string;
    owner: string;
    price: string;
}

/**
 * Union type representing all possible event types from Polymarket WebSocket
 * @example BookEvent
 * {
 *   market: "0xf83fb46dd70a4459fcc441a8511701c463374c5c3c250f585d74fda85ddfb7c9",
 *   asset_id: "101007741586870489619361069512452187353898396425142157315847015703471254508752",
 *   timestamp: "1740759191594",
 *   hash: "c0e51b1cfdbcb1b2aec58feaf7b01004019a89c6",
 *   bids: [{ price: "0.01", size: "510000" }],
 *   asks: [{ price: "0.99", size: "58.07" }],
 *   event_type: "book"
 * }
 * 
 * @example LastTradePriceEvent
 * {
 *   asset_id: "101007741586870489619361069512452187353898396425142157315847015703471254508752",
 *   event_type: "last_trade_price",
 *   fee_rate_bps: "0",
 *   market: "0xf83fb46dd70a4459fcc441a8511701c463374c5c3c250f585d74fda85ddfb7c9",
 *   price: "0.12",
 *   side: "BUY",
 *   size: "8.333332",
 *   timestamp: "1740760245471"
 * }
 * 
 * @example PriceChangeEvent
 * {
 *   asset_id: "39327269875426915204597944387916069897800289788920336317845465327697809453999",
 *   changes: [
 *     { price: "0.044", side: "SELL", size: "611" }
 *   ],
 *   event_type: "price_change",
 *   hash: "a0b7cadf869fc288dbbf65704996fe818cc97d6a",
 *   market: "0x5412ae25e97078f814157de948459d59c6221b4c4c495fdd57b536543ad36729",
 *   timestamp: "1749371014925"
 * }
 * 
 * @example TickSizeChangeEvent
 * {
 *   event_type: "tick_size_change",
 *   asset_id: "65818619657568813474341868652308942079804919287380422192892211131408793125422",
 *   market: "0xbd31dc8a20211944f6b70f31557f1001557b59905b7738480ca09bd4532f84af",
 *   old_tick_size: "0.01",
 *   new_tick_size: "0.001",
 *   timestamp: "100000000"
 * }
 */
export type PolymarketWSEvent = BookEvent | LastTradePriceEvent | PriceChangeEvent | TickSizeChangeEvent;

/**
 * Represents an order event from the user channel
 * This event is emitted for order status changes in the user's account
 * 
 * @example
 * {
 *   "asset_id": "37045026083435026404065735132496247520024977031626253216128699701238754135467",
 *   "associate_trades": null,
 *   "created_at": "1756228682",
 *   "event_type": "order",
 *   "expiration": "0",
 *   "id": "0xd0c6bbfb9670128d3665e21c8b561d65acd4ffa6d98f6465e02ef345bacb764e",
 *   "maker_address": "0xFCD2fDE8e69005fb6Ef78537a2646ad030B26535",
 *   "market": "0x9d03267d12f60205c6c1657cd6fcb54c2be59d4139279296b58ddb3532c8f97c",
 *   "order_owner": "5e955800-3d91-e026-47da-f6183b8a6a20",
 *   "order_type": "GTC",
 *   "original_size": "5",
 *   "outcome": "No",
 *   "owner": "5e955800-3d91-e026-47da-f6183b8a6a20",
 *   "price": "0.999",
 *   "side": "SELL",
 *   "size_matched": "0",
 *   "status": "LIVE",
 *   "timestamp": "1756228682420",
 *   "type": "PLACEMENT"
 * }
 */
export interface OrderEvent {
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

/**
 * Represents a trade event from the user channel
 * This event is emitted when the user's order is executed
 * 
 * @example
 * {
 *   "asset_id": "52114319501245915516055106046884209969926127482827954674443846427813813222426",
 *   "event_type": "trade",
 *   "id": "28c4d2eb-bbea-40e7-a9f0-b2fdb56b2c2e",
 *   "last_update": "1672290701",
 *   "maker_orders": [
 *     {
 *       "asset_id": "52114319501245915516055106046884209969926127482827954674443846427813813222426",
 *       "matched_amount": "10",
 *       "order_id": "0xff354cd7ca7539dfa9c28d90943ab5779a4eac34b9b37a757d7b32bdfb11790b",
 *       "outcome": "YES",
 *       "owner": "9180014b-33c8-9240-a14b-bdca11c0a465",
 *       "price": "0.57"
 *     }
 *   ],
 *   "market": "0xbd31dc8a20211944f6b70f31557f1001557b59905b7738480ca09bd4532f84af",
 *   "matchtime": "1672290701",
 *   "outcome": "YES",
 *   "owner": "9180014b-33c8-9240-a14b-bdca11c0a465",
 *   "price": "0.57",
 *   "side": "BUY",
 *   "size": "10",
 *   "status": "MATCHED",
 *   "taker_order_id": "0x06bc63e346ed4ceddce9efd6b3af37c8f8f440c92fe7da6b2d0f9e4ccbc50c42",
 *   "timestamp": "1672290701",
 *   "trade_owner": "9180014b-33c8-9240-a14b-bdca11c0a465",
 *   "type": "TRADE"
 * }
 */
export interface TradeEvent {
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

/**
 * Union type representing all possible event types from Polymarket User WebSocket
 */
export type PolymarketUserWSEvent = OrderEvent | TradeEvent;

/**
 * Represents a price update event
 * 
 * This is an event that is emitted to faciliate price update events. It is 
 * not emitted by the Polymarket WebSocket directly.
 * 
 * See https://docs.polymarket.com/polymarket-learn/trading/how-are-prices-calculated
 * 
 * TLDR: The prices displayed on Polymarket are the midpoint of the bid-ask spread in the orderbook,
 * UNLESS that spread is over $0.10, in which case the **last traded price** is used.
 */
export interface PolymarketPriceUpdateEvent {
    event_type: 'price_update';
    asset_id: string;
    timestamp: string;
    triggeringEvent: LastTradePriceEvent | PriceChangeEvent;
    book: Book;
    price: string;
    midpoint: string;
    spread: string;
}

/**
 * Represents the handlers for the Polymarket WebSocket
 */
export type WebSocketHandlers = {

    /*
        Polymarket WebSocket event handlers
    */

    // https://docs.polymarket.com/developers/CLOB/websocket/market-channel#book-message
    onBook?: (events: BookEvent[]) => Promise<void>;

    // Currently undocumented, but is emitted when a trade occurs
    onLastTradePrice?: (events: LastTradePriceEvent[]) => Promise<void>;

    // https://docs.polymarket.com/developers/CLOB/websocket/market-channel#tick-size-change-message
    onTickSizeChange?: (events: TickSizeChangeEvent[]) => Promise<void>;

    // https://docs.polymarket.com/developers/CLOB/websocket/market-channel#price-change-message
    onPriceChange?: (events: PriceChangeEvent[]) => Promise<void>;

    /*
        Also mentioned as 'Future Price', this is the price that is displayed on the Polymarket UI
        and denotes the probability of an event happening. Read more about it here:
        https://docs.polymarket.com/polymarket-learn/trading/how-are-prices-calculated#future-price

        This is a derived event that is not emmited by the Polymarket WebSocket directly.
    */
    onPolymarketPriceUpdate?: (events: PolymarketPriceUpdateEvent[]) => Promise<void>;

    // Error handling
    onError?: (error: Error) => Promise<void>;
    onWSClose?: (groupId: string, code: number, reason: string) => Promise<void>;
    onWSOpen?: (groupId: string, assetIds: string[]) => Promise<void>;
}

/**
 * Represents the handlers for the Polymarket User WebSocket
 */
export type UserWebSocketHandlers = {
    /*
        Polymarket User WebSocket event handlers
    */

    // User order updates
    onOrder?: (events: OrderEvent[]) => Promise<void>;

    // User trade updates
    onTrade?: (events: TradeEvent[]) => Promise<void>;

    // Error handling
    onError?: (error: Error) => Promise<void>;
    onWSClose?: (groupId: string, code: number, reason: string) => Promise<void>;
    onWSOpen?: (groupId: string, marketIds: string[]) => Promise<void>;
}

/**
 * Type guard to check if an event is a BookEvent
 * @example
 * if (isBookEvent(event)) {
 *   // event is now typed as BookEvent
 *   console.log(event.bids);
 * }
 */
export function isBookEvent(event: PolymarketWSEvent): event is BookEvent {
    return event?.event_type === 'book';
}

/**
 * Type guard to check if an event is a LastTradePriceEvent
 * @example
 * if (isLastTradePriceEvent(event)) {
 *   // event is now typed as LastTradePriceEvent
 *   console.log(event.side);
 * }
 */
export function isLastTradePriceEvent(event: PolymarketWSEvent): event is LastTradePriceEvent {
    return event?.event_type === 'last_trade_price';
}

/**
 * Type guard to check if an event is a PriceChangeEvent
 * @example
 * if (isPriceChangeEvent(event)) {
 *   // event is now typed as PriceChangeEvent
 *   console.log(event.changes);
 * }
 */
export function isPriceChangeEvent(event: PolymarketWSEvent): event is PriceChangeEvent {
    return event?.event_type === 'price_change';
}

/**
 * Type guard to check if an event is a TickSizeChangeEvent
 * @example
 * if (isTickSizeChangeEvent(event)) {
 *   // event is now typed as TickSizeChangeEvent
 *   console.log(event.old_tick_size);
 * }
 */
export function isTickSizeChangeEvent(event: PolymarketWSEvent): event is TickSizeChangeEvent {
    return event?.event_type === 'tick_size_change';
}

/**
 * Type guard to check if an event is an OrderEvent
 * @example
 * if (isOrderEvent(event)) {
 *   // event is now typed as OrderEvent
 *   console.log(event.id);
 * }
 */
export function isOrderEvent(event: PolymarketUserWSEvent): event is OrderEvent {
    return event?.event_type === 'order';
}

/**
 * Type guard to check if an event is a TradeEvent
 * @example
 * if (isTradeEvent(event)) {
 *   // event is now typed as TradeEvent
 *   console.log(event.id);
 * }
 */
export function isTradeEvent(event: PolymarketUserWSEvent): event is TradeEvent {
    return event?.event_type === 'trade';
}