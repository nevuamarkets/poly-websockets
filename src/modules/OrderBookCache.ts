import _ from 'lodash';
import {
    BookEvent,
    PriceChangeEvent,
    PriceLevel,
} from '../types/PolymarketWebSocket';

/*
 * Shared book cache store – exported so legacy code paths can keep using it
 * until the refactor is complete.
 */
export interface BookEntry {
    bids: PriceLevel[];
    asks: PriceLevel[];
    price: string | null;
    midpoint: string | null;
    spread: string | null;
}

export 

function sortDescendingInPlace(bookSide: PriceLevel[]): void {
    bookSide.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
}

function sortAscendingInPlace(bookSide: PriceLevel[]): void {
    bookSide.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
}

export class OrderBookCache {
    private bookCache: { 
        [assetId: string]: BookEntry 
    } = {};

    constructor() {}

    /**
     * Replace full book (after a `book` event)
     */
    public replaceBook(event: BookEvent): void {
        let lastPrice = null;
        let lastMidpoint = null;
        let lastSpread = null;
        if (this.bookCache[event.asset_id]) {
            lastPrice = this.bookCache[event.asset_id].price;
            lastMidpoint = this.bookCache[event.asset_id].midpoint;
            lastSpread = this.bookCache[event.asset_id].spread;
        }

        this.bookCache[event.asset_id] = {
            bids: [...event.bids],
            asks: [...event.asks],
            price: lastPrice,
            midpoint: lastMidpoint,
            spread: lastSpread,
        };

        /* Polymarket book events are currently sorted as such:
         * - bids (buys) ascending
         * - asks (sells) descending
         * 
         * So we maintain this order in the cache.
         */
        sortAscendingInPlace(this.bookCache[event.asset_id].bids);
        sortDescendingInPlace(this.bookCache[event.asset_id].asks);
    }

    /**
     * Update a cached book from a `price_change` event.
     * 
     * Returns true if the book was updated.
     * Throws if the book is not found.
     */
    public upsertPriceChange(event: PriceChangeEvent): void {
        // Iterate through price_changes array
        for (const priceChange of event.price_changes) {
            const book = this.bookCache[priceChange.asset_id];
            if (!book) {
                throw new Error(`Book not found for asset ${priceChange.asset_id}`);
            }

            const { price, size, side } = priceChange;
            if (side === 'BUY') {
                const i = book.bids.findIndex(bid => bid.price === price);
                if (i !== -1) {
                    book.bids[i].size = size;
                } else {
                    book.bids.push({ price, size });
                    
                    // Ensure the bids are sorted ascending
                    sortAscendingInPlace(book.bids);
                }
            } else {
                const i = book.asks.findIndex(ask => ask.price === price);
                if (i !== -1) {
                    book.asks[i].size = size;
                } else {
                    book.asks.push({ price, size });

                    // Ensure the asks are sorted descending
                    sortDescendingInPlace(book.asks);
                }
            }
        }
    }

    /**
     * Return `true` if best-bid/best-ask spread exceeds `cents`.
     * 
     * Side effect: updates the book's spread
     * 
     * Throws if either side of the book is empty.
     */
    public spreadOver(assetId: string, cents = 0.1): boolean {
        const book = this.bookCache[assetId];
        if (!book) throw new Error(`Book for ${assetId} not cached`);
        if (book.asks.length === 0) throw new Error(`No asks in book for ${assetId}`);
        if (book.bids.length === 0) throw new Error(`No bids in book for ${assetId}`);

        /*
         * Polymarket book events are currently sorted as such:
         * - bids ascending
         * - asks descending
         */
        
        const highestBid = book.bids[book.bids.length - 1].price;
        const lowestAsk = book.asks[book.asks.length - 1].price;
        
        const highestBidNum = parseFloat(highestBid);
        const lowestAskNum = parseFloat(lowestAsk);

        const spread = lowestAskNum - highestBidNum;

        if (isNaN(spread)) {
            throw new Error(`Spread is NaN: lowestAsk '${lowestAsk}' highestBid '${highestBid}'`);
        }

        /*
        *   Update spead, 3 precision decimal places, trim trailing zeros
        */
        book.spread = parseFloat(spread.toFixed(3)).toString();

        // Should be safe for 0.### - precision values
        return spread > cents;
    }

    /** 
     * Calculate the midpoint of the book, rounded to 3dp, no trailing zeros 
     * 
     * Side effect: updates the book's midpoint
     * 
     * Throws if
     * - the book is not found or missing either bid or ask
     * - the midpoint is NaN.
    */
    public midpoint(assetId: string): string {
        const book = this.bookCache[assetId];
        if (!book) throw new Error(`Book for ${assetId} not cached`);
        if (book.asks.length === 0) throw new Error(`No asks in book for ${assetId}`);
        if (book.bids.length === 0) throw new Error(`No bids in book for ${assetId}`);

        /*
         * Polymarket book events are currently sorted as such:
         * - bids ascending
         * - asks descending
         */
        const highestBid = book.bids[book.bids.length - 1].price;
        const lowestAsk = book.asks[book.asks.length - 1].price;

        const highestBidNum = parseFloat(highestBid);
        const lowestAskNum = parseFloat(lowestAsk);

        const midpoint = (highestBidNum + lowestAskNum) / 2;

        if (isNaN(midpoint)) {
            throw new Error(`Midpoint is NaN: lowestAsk '${lowestAsk}' highestBid '${highestBid}'`);
        }

        /*
        *   Update midpoint, 3 precision decimal places, trim trailing zeros
        */
        book.midpoint = parseFloat(midpoint.toFixed(3)).toString();

        return parseFloat(midpoint.toFixed(3)).toString();
    }

    public clear(assetId?: string): void {
        if (assetId) {
            delete this.bookCache[assetId];
        } else {
            for (const k of Object.keys(this.bookCache)) {
                delete this.bookCache[k];
            }
        }
    }

    /**
     * Get a book entry by asset id.
     * 
     * Return null if the book is not found.
     */
    public getBookEntry(assetId: string): BookEntry | null {
        if (!this.bookCache[assetId]) {
            return null;
        }
        return this.bookCache[assetId];
    }

} 