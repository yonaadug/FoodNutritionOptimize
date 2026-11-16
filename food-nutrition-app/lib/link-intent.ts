/**
 * When a link fetches its page ahead of time. Pages aren't cached in front of the server,
 * so each fetch ahead is a request to it, and next/link's default (fetch every link that
 * comes on screen) sends dozens at once from a page of links. So a link waits for a sign
 * that someone may follow it. Kept pure so it can be unit tested without a browser.
 * The component that applies these rules is components/ui/IntentLink.tsx.
 */

/** What happened to a link that might show someone is about to follow it. */
export type LinkIntentEvent =
    /** A pointer came over it. */
    | { type: 'pointerenter'; pointerType: string }
    /** It took focus; `keyboard` when the browser judges that focus came from the keyboard (:focus-visible). */
    | { type: 'focus'; keyboard: boolean };

/**
 * Does this event show that someone may follow the link? A mouse pointing at it, or
 * keyboard focus moving to it: both usually come well before the click.
 *
 * A finger or pen touching it doesn't count, nor does the focus a click or tap gives it.
 * A whole fetch ahead takes two trips to the server (the page's outline, then its data),
 * and a tap lasts about a tenth of a second, so the page would change before the fetch
 * was done and wait for it: measured with a 300 ms server, a tap that fetched on touching
 * down sent 3 requests and showed the page 420-630 ms after the finger lifted, against
 * 1 request and 350-390 ms for a plain tap. A slow page shows its skeleton meanwhile.
 */
export function showsIntent(event: LinkIntentEvent): boolean {
    switch (event.type) {
        case 'pointerenter': return event.pointerType === 'mouse';
        case 'focus': return event.keyboard;
        default: return false;
    }
}

/**
 * The `prefetch` value for next/link: false (nothing, however long the link is on screen)
 * until someone shows intent, then true (the whole page, so it usually opens at once).
 * A link that opens another tab never fetches ahead: that tab loads the page itself.
 */
export function linkPrefetch(intent: boolean, target?: string): boolean {
    return intent && (!target || target === '_self');
}
