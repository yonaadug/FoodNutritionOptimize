/**
 * Site-wide navigation and URLs. Pure data (safe for client components).
 *
 * The header (components/shell/SiteHeader.tsx) renders NAV_ITEMS in order; add
 * a section here and it appears on desktop and in the compact phone nav.
 */

export interface NavItem {
    href: string;
    label: string;
    /** Short hint used as the link's title. */
    hint: string;
    /** Other path prefixes that belong to this section (for the active state). */
    alsoActiveOn?: string[];
}

export const NAV_ITEMS: readonly NavItem[] = [
    { href: '/', label: 'Foods', hint: 'Look up any food and its nutrients', alsoActiveOn: ['/food', '/nutrients'] },
    { href: '/plan', label: 'Plan', hint: 'Plan a day of eating that meets your goals' },
    { href: '/recipes', label: 'Recipes', hint: 'Work out the nutrition of a recipe' },
];

function under(pathname: string, prefix: string): boolean {
    if (prefix === '/') return pathname === '/';
    return pathname === prefix || pathname.startsWith(prefix + '/');
}

/** Is this nav item the current section? "/" only matches the home page itself. */
export function isNavActive(item: NavItem, pathname: string | null | undefined): boolean {
    const path = (pathname || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    return under(path, item.href) || (item.alsoActiveOn ?? []).some(p => under(path, p));
}

export const SITE_NAME = 'Micronutrient Diary';

/** One line that says what the site is. */
export const SITE_TAGLINE = 'Look up the nutrients and contaminants in any food, work out a recipe’s nutrition, and plan a day that meets your goals.';

/** Canonical origin, without a trailing slash. Set NEXT_PUBLIC_SITE_URL per environment. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://micronutrientdiary.com').replace(/\/+$/, '');

/** Absolute URL for a site path. */
export function absoluteUrl(path: string): string {
    return SITE_URL + (path.startsWith('/') ? path : `/${path}`);
}
