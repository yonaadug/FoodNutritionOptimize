'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { lazy, Suspense } from 'react';
import { useCurrentUser, type CurrentUser } from '@/lib/auth/client';
import { nextFromLocation, signInPath } from '@/lib/auth/next-path';
import styles from './AccountMenu.module.css';

// Only signed-in people need the menu, so it loads on its own rather than with every page.
const SignedInMenu = lazy(() => import('./SignedInMenu'));

/** "Sign in" for anonymous visitors; an initial with a menu for signed-in people. */
export function userInitial(user: Pick<CurrentUser, 'displayName' | 'email'>): string {
    return (user.displayName.trim() || user.email).charAt(0).toUpperCase() || '?';
}

/** `current`: an account page is open, so the control is marked as the current section. */
export default function AccountMenu({ current = false }: { current?: boolean }) {
    const { user, loading } = useCurrentUser();
    const router = useRouter();
    const pathname = usePathname();
    if (!user) {
        // Read the address on click: it changes without a navigation (search, the recipe editor, the plan's step).
        const goToSignIn = (e: React.MouseEvent) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            router.push(signInPath(nextFromLocation(window.location)));
        };
        // While a browser that was signed in is still being checked, the link holds its place
        // invisibly (app/layout.tsx marks such browsers before the first paint), so the header
        // doesn't show "Sign in" and then swap it for the account button.
        return (
            <Link href="/account/sign-in" onClick={goToSignIn} className={`btn btn-secondary btn-sm ${styles.signIn}`}
                aria-current={current ? 'page' : undefined} data-pending={loading || undefined}>
                Sign in
            </Link>
        );
    }
    return (
        <Suspense fallback={<span className={styles.avatar} aria-hidden="true" />}>
            <SignedInMenu user={user} current={current} pathname={pathname} />
        </Suspense>
    );
}
