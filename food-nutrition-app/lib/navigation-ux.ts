/**
 * Small, DOM-light rules for what happens around a page change: where focus goes,
 * where the page scrolls to, and whether motion is wanted. Kept pure (they take what
 * they need as arguments) so they can be unit tested without a browser.
 * The component that applies them is components/shell/NavigationEffects.tsx.
 */

/** Does this visitor ask for less motion? False wherever there's no window (server, tests). */
export function prefersReducedMotion(win: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window): boolean {
    try {
        return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

/** 'smooth' scrolling, unless the visitor prefers reduced motion. */
export function scrollBehavior(win?: Pick<Window, 'matchMedia'>): ScrollBehavior {
    return prefersReducedMotion(win) ? 'auto' : 'smooth';
}

/** The key a page's scroll position is remembered under: the whole address, without the origin. */
export function locationKey(loc: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
    return `${loc.pathname}${loc.search}${loc.hash}`;
}

/**
 * After a page change, should focus move to the new page? Yes when it was left on
 * nothing (the clicked link was removed), on a removed element, or outside the page
 * content (a header link stays focused when the header doesn't change). No when the
 * page has already put it somewhere inside the content, like the home page's search box.
 */
export function shouldMoveFocus(active: Element | null, content: Element | null, body: Element | null): boolean {
    if (!content) return false;
    if (!active || active === body || !active.isConnected) return true;
    return !content.contains(active) || active === content;
}

/** The loading skeletons there are, one per kind of page that reads the database. */
export type SkeletonKind = 'home' | 'food' | 'food-list' | 'link-index' | 'account';

/**
 * Which skeleton stands in for a page while it loads. Null for the pages that are built
 * ahead of time (the planner, recipes, methodology): those are prefetched in full, so
 * they open at once.
 */
export function skeletonFor(pathname: string): SkeletonKind | null {
    const p = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    if (p === '/') return 'home';
    if (p === '/food/category' || p === '/nutrients') return 'link-index';
    if (/^\/food\/category\/[^/]+$/.test(p) || /^\/nutrients\/[^/]+$/.test(p)) return 'food-list';
    if (/^\/food\/[^/]+$/.test(p)) return 'food';
    if (p === '/account' || p.startsWith('/account/')) return 'account';
    return null;
}

/** What a click looked like, as far as deciding whether the site is about to change page. */
export interface ClickFacts {
    /** The link's resolved href (anchor.href). */
    href: string;
    /** The link's target attribute. */
    target: string;
    download: boolean;
    /** Next's <Link> calls preventDefault when it takes over the navigation. */
    defaultPrevented: boolean;
    button: number;
    modifier: boolean;
}

/**
 * The address a click is taking the site to, client-side, or null if it isn't one:
 * a new tab or window, a download, another site, or the same page (a #hash or nothing).
 */
export function clientNavigationTarget(click: ClickFacts, current: Pick<URL, 'origin' | 'pathname' | 'search'>): URL | null {
    if (!click.defaultPrevented || click.button !== 0 || click.modifier || click.download) return null;
    if (click.target && click.target !== '_self') return null;
    let url: URL;
    try {
        url = new URL(click.href);
    } catch {
        return null;
    }
    if (url.origin !== current.origin) return null;
    if (url.pathname === current.pathname && url.search === current.search) return null;
    return url;
}

/** A tiny cache that forgets the least recently stored entry past its limit. */
export class RecentCache<V> {
    private readonly entries = new Map<string, V>();
    private readonly limit: number;

    constructor(limit = 30) {
        this.limit = limit;
    }

    get(key: string): V | undefined {
        return this.entries.get(key);
    }

    set(key: string, value: V) {
        this.entries.delete(key);
        this.entries.set(key, value);
        if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    }
}

/** Remembers scroll positions per address, so Back and Forward can put them back. */
export class ScrollMemory extends RecentCache<number> {
    constructor(limit = 50) {
        super(limit);
    }

    save(key: string, y: number) {
        this.set(key, Math.max(0, Math.round(y)));
    }
}

/**
 * Where a page should be scrolled to once it is on screen.
 * - Back or Forward: where it was when it was left, if known.
 * - A new page: the element the #hash names, else the top.
 * Returns null when nothing should change.
 */
export function scrollTargetFor(opts: {
    traversal: boolean;
    remembered: number | undefined;
    pathChanged: boolean;
    hashTargetExists: boolean;
}): number | 'hash' | null {
    if (opts.traversal) return opts.remembered ?? null;
    if (!opts.pathChanged) return null;
    return opts.hashTargetExists ? 'hash' : 0;
}
