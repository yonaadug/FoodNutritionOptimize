'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { signOut, useCurrentUser, type CurrentUser } from '@/lib/auth/client';
import styles from './AccountMenu.module.css';

/** "Sign in" for anonymous visitors; an initial with a menu for signed-in people. */
export function userInitial(user: Pick<CurrentUser, 'displayName' | 'email'>): string {
    return (user.displayName.trim() || user.email).charAt(0).toUpperCase() || '?';
}

export default function AccountMenu() {
    const { user } = useCurrentUser();
    if (!user) {
        return <Link href="/account/sign-in" prefetch={false} className={`btn btn-secondary btn-sm ${styles.signIn}`}>Sign in</Link>;
    }
    return <SignedInMenu user={user} />;
}

function SignedInMenu({ user }: { user: CurrentUser }) {
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
                    <Link role="menuitem" href="/account" prefetch={false} className={styles.item} onClick={() => setOpen(false)}>Account</Link>
                    <Link role="menuitem" href="/account/history" prefetch={false} className={styles.item} onClick={() => setOpen(false)}>History</Link>
                    <button role="menuitem" type="button" className={styles.item} onClick={onSignOut}>Sign out</button>
                </div>
            )}
        </div>
    );
}
