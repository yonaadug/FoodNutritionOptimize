/**
 * When a link fetches its page ahead of time. Pages aren't cached in front of the server,
 * so each fetch ahead is a request to it, and next/link's default (fetch every link that
 * comes on screen) sends dozens at once from a page of links. So a link waits for a sign
 * that someone may follow it. Kept pure so it can be unit tested without a browser.
 * The component that applies these rules is components/ui/IntentLink.tsx.
 */

/** The events a link watches for a sign that someone may follow it. */
export type LinkIntentEvent = 'pointerenter' | 'pointerdown' | 'focus';

/**
 * Does this event show that someone may follow the link?
 * - `pointerenter` from a mouse: pointing at it;
 * - `pointerdown` from a finger or pen: touching it (phones have no hover), a moment
 *   before the tap ends and the page changes;
 * - `focus`: moving to it with the keyboard.
 * A touch's own pointerenter comes just before its pointerdown, and a mouse press always
 * follows its pointerenter, so neither counts twice.
 */
export function showsIntent(event: LinkIntentEvent, pointerType?: string): boolean {
    switch (event) {
        case 'pointerenter': return pointerType === 'mouse';
        case 'pointerdown': return pointerType === 'touch' || pointerType === 'pen';
        case 'focus': return true;
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
