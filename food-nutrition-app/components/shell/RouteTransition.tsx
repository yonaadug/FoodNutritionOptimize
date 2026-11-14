'use client';

import { ViewTransition } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Cross-fades from one page to the next, using React's <ViewTransition> (the browser's
 * View Transitions API). Keyed by the path, so a new page is an exit plus an enter: the
 * old page fades out where it was and the new one fades in at the top, with no sliding
 * between scroll positions. Changes within a page (search as you type, the planner's
 * step, a recipe's ?id) keep the same key and don't animate.
 *
 * The header stays put and the footer doesn't fade: see "Page transitions" in
 * app/globals.css. Browsers without the API, and anyone who prefers reduced motion,
 * get an instant swap.
 */
export default function RouteTransition({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    return (
        <ViewTransition key={pathname} enter="page-enter" exit="page-exit" default="none">
            {children}
        </ViewTransition>
    );
}
