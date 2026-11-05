import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AccountFrame from '@/components/account/AccountFrame';
import FinishSignIn from '@/components/account/FinishSignIn';
import styles from '@/components/account/account.module.css';
import { safeNextPath, signInPath } from '@/lib/auth/next-path';
import { getPageUser } from '@/lib/auth/pages';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Signing you in' };

/**
 * Where a sign-in link lands. The session cookie is httpOnly, so the browser's scripts
 * can't see that someone has just signed in. This page can, tells them, and moves on to
 * the page they started from. `next` is checked again here: anyone can craft this address.
 */
export default async function FinishSignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const raw = (await searchParams).next;
    const next = safeNextPath(typeof raw === 'string' ? raw : undefined);
    const user = await getPageUser();
    if (!user) redirect(signInPath(next));
    return (
        <AccountFrame narrow>
            <section className="panel" aria-labelledby="done-title">
                <h1 id="done-title" className={styles.heading}>You&apos;re signed in</h1>
                <p className={styles.lede} role="status"><span className="spinner" /> Taking you back…</p>
                <FinishSignIn user={user} next={next} />
            </section>
        </AccountFrame>
    );
}
