'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
    clientNavigationTarget, locationKey, RecentCache, ScrollMemory, scrollTargetFor, shouldMoveFocus, skeletonFor, type SkeletonKind,
} from '@/lib/navigation-ux';

// The skeletons load on their own, once the page is idle, so they add nothing to the first load.
let PageSkeleton: typeof import('./PageSkeletons').default | null = null;
const loadSkeletons = () => import('./PageSkeletons').then(m => { PageSkeleton = m.default; });

/** How long after a popstate a route change still counts as Back/Forward. */
const TRAVERSAL_WINDOW_MS = 1500;
/** How long to keep putting a restored scroll position back while late content arrives. */
const RESTORE_FOR_MS = 1500;
/** A page that arrives sooner than this never shows a skeleton (no flash on fast or prefetched pages). */
const SKELETON_DELAY_MS = 90;
/** Give up on a page change that never arrives (an error page will have replaced it by then). */
const SKELETON_MAX_MS = 15000;

const scrolls = new ScrollMemory();
/** The link that was followed from each address, so Back can return focus to it. */
const followedLinks = new RecentCache<string>(50);

let lastPopstate = 0;
let lastUserAction = 0;
let popTarget: number | undefined;
let restoring = false;
let stopRestore: (() => void) | null = null;
let pendingSeq = 0;

const contentArea = () => document.getElementById('main');

function isTraversal(): boolean {
    return lastPopstate > lastUserAction && performance.now() - lastPopstate < TRAVERSAL_WINDOW_MS;
}

const VISITOR_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/** Scroll to `y` now, and again as the page grows (late data, images), until it sticks or the visitor scrolls. */
function restoreScroll(y: number) {
    stopRestore?.();
    let active = true;
    restoring = true;
    const started = performance.now();
    let stableFrames = 0;
    const stop = (save: boolean) => {
        if (!active) return;
        active = false;
        restoring = false;
        stopRestore = null;
        for (const type of VISITOR_INPUT) removeEventListener(type, onInput);
        if (save) scrolls.save(locationKey(window.location), window.scrollY);
    };
    const onInput = () => stop(true);
    for (const type of VISITOR_INPUT) addEventListener(type, onInput, { passive: true });
    stopRestore = () => stop(false);
    const tick = () => {
        if (!active) return;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const want = Math.min(y, Math.max(0, max));
        if (Math.abs(window.scrollY - want) > 1) window.scrollTo({ top: want, behavior: 'instant' });
        stableFrames = max >= y - 1 ? stableFrames + 1 : 0;
        if (stableFrames >= 3 || performance.now() - started > RESTORE_FOR_MS) stop(true);
        else requestAnimationFrame(tick);
    };
    tick();
}

/** Focus the new page's main heading, so keyboard and screen reader users start on the new content. */
function focusHeading(content: HTMLElement) {
    const heading = content.querySelector<HTMLElement>('h1');
    if (!heading) {
        content.focus({ preventScroll: true });
        return;
    }
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.setAttribute('data-route-focus', '');
    heading.focus({ preventScroll: true });
}

interface Pending {
    id: number;
    /** The route the click was on: the skeleton only shows while that is still on screen. */
    from: string;
    kind: SkeletonKind;
    visible: boolean;
    top: number;
}

/**
 * What the site does around a page change, beyond what Next.js does itself:
 * - when the next page takes a moment (it reads the database, and wasn't fetched ahead),
 *   a skeleton shaped like it covers the old page within a tenth of a second;
 * - a new page starts at the top (Next keeps the old position when the new page's top is
 *   in view, or when a #hash names nothing, as with /plan#foods);
 * - Back and Forward put the page back where it was, even when its content arrives a
 *   moment later (a recipe, search results, the contaminant panel);
 * - focus moves to the new page's main heading (or back to the link followed, on Back),
 *   and Next's route announcer reads the new page's title;
 * - when the browser draws its own swipe animation for Back, the page transition is skipped.
 * The rules themselves are in lib/navigation-ux.ts.
 */
export default function NavigationEffects() {
    const pathname = usePathname();
    const search = useSearchParams().toString();
    const route = `${pathname}?${search}`;
    const previous = useRef<{ route: string; pathname: string } | null>(null);
    const currentRoute = useRef(route);
    const [pending, setPending] = useState<Pending | null>(null);

    useEffect(() => {
        // Restoring scroll is done here, after the new page has rendered, rather than by the
        // browser on popstate, when the old page (or a half-loaded new one) is still on screen.
        // A reload still restores natively: the setting is handed back as the page unloads.
        try { history.scrollRestoration = 'manual'; } catch { /* very old browsers */ }
        const onPageHide = () => { try { history.scrollRestoration = 'auto'; } catch { /* ignore */ } };
        const onPageShow = () => { try { history.scrollRestoration = 'manual'; } catch { /* ignore */ } };

        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                if (!restoring) scrolls.save(locationKey(window.location), window.scrollY);
            });
        };
        const onAction = () => { lastUserAction = performance.now(); };
        // Capture phase: before the page reacts, note the click and the link followed.
        const onClickCapture = (e: MouseEvent) => {
            onAction();
            if (!restoring) scrolls.save(locationKey(window.location), window.scrollY);
            const link = (e.target as Element | null)?.closest?.('a[href]');
            const href = link?.getAttribute('href');
            if (href?.startsWith('/')) followedLinks.set(locationKey(window.location), href);
        };
        // Bubble phase on window: after Next's <Link> has decided to handle it (preventDefault).
        const onClick = (e: MouseEvent) => {
            const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!link) return;
            const to = clientNavigationTarget({
                href: link.href,
                target: link.target,
                download: link.hasAttribute('download'),
                defaultPrevented: e.defaultPrevented,
                button: e.button,
                modifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
            }, new URL(window.location.href));
            const kind = to && skeletonFor(to.pathname);
            // Until the skeletons have loaded, the old page simply stays up (better than a blank cover).
            if (!kind || !PageSkeleton) return;
            const id = ++pendingSeq;
            setPending({ id, from: currentRoute.current, kind, visible: false, top: 0 });
            window.setTimeout(() => {
                const top = Math.max(0, document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 60);
                setPending(p => (p?.id === id ? { ...p, visible: true, top } : p));
            }, SKELETON_DELAY_MS);
            window.setTimeout(() => setPending(p => (p?.id === id ? null : p)), SKELETON_MAX_MS);
        };
        // Back or Forward is starting: note where the page we're going to was left.
        const startTraversal = (destination: string, uaTransition: boolean) => {
            lastPopstate = performance.now();
            stopRestore?.();
            if (frame) { cancelAnimationFrame(frame); frame = 0; }
            setPending(null);
            popTarget = scrolls.get(destination);
            // Safari and Chrome on phones animate a swipe Back themselves: don't animate it twice.
            if (uaTransition) {
                document.documentElement.setAttribute('data-ua-transition', '');
                window.setTimeout(() => document.documentElement.removeAttribute('data-ua-transition'), 1000);
            }
        };
        // Where the Navigation API exists, it says so before the router renders the page (popstate can come after).
        type TraverseEvent = Event & { navigationType?: string; destination?: { url: string }; hasUAVisualTransition?: boolean };
        const navigationApi = (window as unknown as { navigation?: EventTarget }).navigation;
        const onNavigate = (event: Event) => {
            const e = event as TraverseEvent;
            if (e.navigationType !== 'traverse' || !e.destination) return;
            if (!restoring) scrolls.save(locationKey(window.location), window.scrollY);
            startTraversal(locationKey(new URL(e.destination.url)), !!e.hasUAVisualTransition);
        };
        const onPopState = (e: PopStateEvent) => {
            if (performance.now() - lastPopstate > 200) {
                startTraversal(locationKey(window.location), !!(e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition);
            }
            // Same page, different #hash (the planner's steps): the route doesn't re-render, so restore here.
            const here = `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;
            if (here === currentRoute.current && popTarget !== undefined) {
                const y = popTarget;
                requestAnimationFrame(() => restoreScroll(y));
            }
        };
        if (window.requestIdleCallback) window.requestIdleCallback(() => { void loadSkeletons(); }, { timeout: 2000 });
        else window.setTimeout(() => { void loadSkeletons(); }, 1000);
        navigationApi?.addEventListener('navigate', onNavigate);
        addEventListener('scroll', onScroll, { passive: true });
        addEventListener('click', onClickCapture, true);
        addEventListener('click', onClick);
        addEventListener('keydown', onAction, true);
        // Capture: runs before Next's own popstate listener, which can render the page synchronously.
        addEventListener('popstate', onPopState, true);
        addEventListener('pagehide', onPageHide);
        addEventListener('pageshow', onPageShow);
        return () => {
            navigationApi?.removeEventListener('navigate', onNavigate);
            removeEventListener('scroll', onScroll);
            removeEventListener('click', onClickCapture, true);
            removeEventListener('click', onClick);
            removeEventListener('keydown', onAction, true);
            removeEventListener('popstate', onPopState, true);
            removeEventListener('pagehide', onPageHide);
            removeEventListener('pageshow', onPageShow);
            if (frame) cancelAnimationFrame(frame);
        };
    }, []);

    const showSkeleton = !!pending?.visible && pending.from === route;

    // Scroll, before the new page is painted.
    useLayoutEffect(() => {
        currentRoute.current = route;
        const prev = previous.current;
        if (!prev || prev.route === route) return;
        const hash = decodeURIComponent(window.location.hash.slice(1));
        const target = scrollTargetFor({
            traversal: isTraversal(),
            remembered: popTarget,
            pathChanged: prev.pathname !== pathname,
            hashTargetExists: !!hash && !!document.getElementById(hash),
        });
        if (typeof target === 'number') {
            if (isTraversal()) restoreScroll(target);
            else if (window.scrollY !== target) window.scrollTo({ top: target, behavior: 'instant' });
        }
    }, [route, pathname]);

    // While the skeleton covers it, the old page is hidden, so it doesn't flash back as the new one fades in.
    useLayoutEffect(() => {
        const content = contentArea();
        if (!content) return;
        if (showSkeleton) content.setAttribute('data-nav-pending', '');
        else content.removeAttribute('data-nav-pending');
    }, [showSkeleton]);

    // Focus, once the new page is on screen.
    useEffect(() => {
        const prev = previous.current;
        previous.current = { route, pathname };
        if (!prev || prev.pathname === pathname) return;
        const traversal = isTraversal();
        // A frame later: Back can render this synchronously, inside the page transition's
        // update, where the browser doesn't take focus yet.
        const frame = requestAnimationFrame(() => {
            const content = contentArea();
            if (!content || !shouldMoveFocus(document.activeElement, content, document.body)) return;
            if (traversal) {
                const href = followedLinks.get(locationKey(window.location));
                const link = href ? content.querySelector<HTMLElement>(`a[href="${CSS.escape(href)}"]`) : null;
                if (link) {
                    link.focus({ preventScroll: true });
                    return;
                }
            }
            focusHeading(content);
        });
        return () => cancelAnimationFrame(frame);
    }, [route, pathname]);

    if (!showSkeleton || !pending || !PageSkeleton) return null;
    return (
        <div className="nav-pending" style={{ top: pending.top }} aria-hidden="true">
            <PageSkeleton kind={pending.kind} />
        </div>
    );
}
