'use client';

import Link from 'next/link';
import { useState } from 'react';

type IntentLinkProps = React.ComponentProps<typeof Link> & {
    /** Long lists (a plan, a recipe): don't fetch anything until someone points at the link. */
    lazy?: boolean;
};

/**
 * A link that fetches the whole page ahead of time once someone shows they may follow it:
 * a mouse over it, or keyboard focus on it. Until then it gets Next's default (just the
 * page's loading shell, which is cheap), or nothing with `lazy`. Phones have no hover, so
 * a page of food cards doesn't fetch every food: a tap shows the loading skeleton at once
 * and the page follows.
 */
export default function IntentLink({ lazy = false, onPointerEnter, onFocus, ...props }: IntentLinkProps) {
    const [intent, setIntent] = useState(false);
    return (
        <Link
            {...props}
            prefetch={intent ? true : lazy ? false : null}
            onPointerEnter={e => {
                if (e.pointerType === 'mouse') setIntent(true);
                onPointerEnter?.(e);
            }}
            onFocus={e => {
                setIntent(true);
                onFocus?.(e);
            }}
        />
    );
}
