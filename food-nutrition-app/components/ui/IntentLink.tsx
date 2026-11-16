'use client';

import Link from 'next/link';
import { useState } from 'react';
import { linkPrefetch, showsIntent } from '@/lib/link-intent';

/** next/link's props, less `prefetch`: when to fetch ahead is decided here, for every link. */
type IntentLinkProps = Omit<React.ComponentProps<typeof Link>, 'prefetch'>;

/** Did focus come from the keyboard, as the browser judges it when it draws focus rings? */
function isKeyboardFocus(el: Element): boolean {
    try {
        return el.matches(':focus-visible');
    } catch {
        return true; // a browser without :focus-visible
    }
}

/**
 * The site's in-app link: every link to another page uses it instead of next/link (a test
 * in lib/link-intent.test.ts keeps it that way). It fetches nothing ahead of time just for
 * being on screen: pages aren't cached in front of the server, so that would be a request
 * per link, dozens at once on a page of links. Once someone shows they may follow it (a
 * mouse over it, or keyboard focus on it) it fetches the whole page, so the page usually
 * opens at once. A tap, or a click on a link nobody pointed at, loads the page then, and
 * if that takes a moment NavigationEffects covers the old page with a skeleton shaped like
 * the new one. The rules, and why a touch doesn't count, are in lib/link-intent.ts.
 *
 * It's a client component, but server components can render it like next/link, as long
 * as they pass no functions (onClick and the like).
 */
export default function IntentLink({ onPointerEnter, onFocus, ...props }: IntentLinkProps) {
    const [intent, setIntent] = useState(false);
    return (
        <Link
            {...props}
            prefetch={linkPrefetch(intent, props.target)}
            onPointerEnter={e => {
                if (showsIntent({ type: 'pointerenter', pointerType: e.pointerType })) setIntent(true);
                onPointerEnter?.(e);
            }}
            onFocus={e => {
                if (showsIntent({ type: 'focus', keyboard: isKeyboardFocus(e.currentTarget) })) setIntent(true);
                onFocus?.(e);
            }}
        />
    );
}
