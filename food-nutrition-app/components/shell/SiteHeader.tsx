'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AccountMenu from '@/components/account/AccountMenu';
import Icon from '@/components/ui/Icon';
import ThemeToggle from '@/components/ThemeToggle';
import { isNavActive, NAV_ITEMS, SITE_NAME } from '@/lib/nav';

/** Skips the header without changing the address (the planner keeps its step in the #hash). */
export function SkipLink() {
    return (
        <a href="#main" className="skip-link" onClick={e => {
            e.preventDefault();
            const main = document.getElementById('main');
            main?.focus();
            main?.scrollIntoView();
        }}>Skip to content</a>
    );
}

/**
 * Site header: brand, main navigation (lib/nav.ts) and global controls.
 * On phones the navigation becomes a second, full-width row of tabs, so no
 * section is hidden behind a menu. Account pages are reached from the account
 * menu ("Sign in", or the signed-in person's initial).
 */
export default function SiteHeader() {
    const pathname = usePathname();
    return (
        <header className="site-header">
            <div className="container site-header-inner">
                <Link href="/" className="brand" aria-label={`${SITE_NAME} home`}>
                    <span className="brand-mark"><Icon name="leaf" size={17} strokeWidth={2.4} /></span>
                    {SITE_NAME}
                </Link>
                <nav className="site-nav" aria-label="Main">
                    {NAV_ITEMS.map(item => {
                        const active = isNavActive(item, pathname);
                        return (
                            <Link key={item.href} href={item.href} title={item.hint} className="site-nav-link"
                                aria-current={active ? 'page' : undefined}>
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>
                <span className="spacer" />
                <AccountMenu />
                <ThemeToggle />
            </div>
        </header>
    );
}
