'use client';

import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

function subscribe(cb: () => void) {
    const obs = new MutationObserver(cb);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
}

const getSnapshot = (): Theme => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
const getServerSnapshot = (): Theme | null => null;

/** Theme switch. The initial theme is set by an inline script in layout.tsx (saved choice, else OS preference). */
export default function ThemeToggle() {
    const theme = useSyncExternalStore<Theme | null>(subscribe, getSnapshot, getServerSnapshot);

    const toggle = () => {
        const next: Theme = theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch { /* ignore */ }
    };

    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

    return (
        <button type="button" className="icon-btn" onClick={toggle} aria-label={label} title={label}>
            {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="4.5" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
            ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
            )}
        </button>
    );
}
