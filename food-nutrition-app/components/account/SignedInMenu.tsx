'use client';

import IntentLink from '@/components/ui/IntentLink';
import { useEffect, useId, useRef, useState } from 'react';
import { signOut, type CurrentUser } from '@/lib/auth/client';
import { userInitial } from './AccountMenu';
import styles from './AccountMenu.module.css';

/** The signed-in person's initial, with a menu: Account, History, Plus, Sign out. Loaded by AccountMenu. */
export default function SignedInMenu({ user, current, pathname }: { user: CurrentUser; current: boolean; pathname: string }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const menuId = useId();

    const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

    useEffect(() => {
        if (!open) return;
        items()[0]?.focus();
        const onPointer = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointer);
        return () => document.removeEventListener('pointerdown', onPointer);
    }, [open]);

    const onMenuKey = (e: React.KeyboardEvent) => {
        const all = items();
        const at = all.indexOf(document.activeElement as HTMLElement);
        const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 };
        if (e.key in moves) {
            e.preventDefault();
            all[(moves[e.key] + all.length) % all.length]?.focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            button.current?.focus();
        } else if (e.key === 'Tab') {
            setOpen(false);
        }
    };

    const onSignOut = async () => {
        setOpen(false);
        try {
            await signOut();
        } finally {
            window.location.replace('/');
        }
    };

    return (
        <div className={styles.root} ref={root}>
            <button
                ref={button}
                type="button"
                className={styles.avatar}
                data-current={current || undefined}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-label={`Account menu for ${user.displayName || user.email}`}
                onClick={() => setOpen(o => !o)}
                onKeyDown={e => {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                <span aria-hidden="true">{userInitial(user)}</span>
            </button>
            {open && (
                <div id={menuId} ref={menu} role="menu" aria-label="Account" className={styles.menu} onKeyDown={onMenuKey}>
                    <p className={styles.who} title={user.email}>{user.email}</p>
                    <IntentLink role="menuitem" href="/account" className={styles.item} onClick={() => setOpen(false)}
                        aria-current={pathname === '/account' ? 'page' : undefined}>Account</IntentLink>
                    <IntentLink role="menuitem" href="/account/history" className={styles.item} onClick={() => setOpen(false)}
                        aria-current={pathname === '/account/history' ? 'page' : undefined}>History</IntentLink>
                    <IntentLink role="menuitem" href="/plus" className={styles.item} onClick={() => setOpen(false)}
                        aria-current={pathname === '/plus' ? 'page' : undefined}>{user.plan?.plan === 'plus' ? 'Your Plus plan' : 'Plus'}</IntentLink>
                    <button role="menuitem" type="button" className={styles.item} onClick={onSignOut}>Sign out</button>
                </div>
            )}
        </div>
    );
}
