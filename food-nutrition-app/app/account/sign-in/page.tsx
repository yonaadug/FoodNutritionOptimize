import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AccountFrame from '@/components/account/AccountFrame';
import SignInForm from '@/components/account/SignInForm';
import styles from '@/components/account/account.module.css';
import Icon from '@/components/ui/Icon';
import { isSafeHref } from '@/lib/auth/history-summary';
import { getPageUser, getSignInOptions } from '@/lib/auth/pages';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in · Micronutrient Diary' };

const single = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

function errorMessage(code: string | undefined): string | null {
    if (!code) return null;
    if (code === 'INVALID_TOKEN' || code === 'EXPIRED_TOKEN') return 'That sign-in link has expired or was already used. Request a new one below.';
    return 'We couldn\'t sign you in with that link. Request a new one below.';
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const rawNext = single(params.next);
    const next = isSafeHref(rawNext) ? rawNext : '/account';

    if (await getPageUser()) redirect(next);

    const options = getSignInOptions();
    const error = errorMessage(single(params.error));

    return (
        <AccountFrame narrow>
            {single(params.deleted) === '1' && (
                <div role="status" className={`${styles.notice} ${styles.noticeSuccess}`}>
                    <Icon name="check" />
                    <span className={styles.noticeBody}>Your account and history have been deleted.</span>
                </div>
            )}
            <section className="panel" aria-labelledby="sign-in-title">
                <h1 id="sign-in-title" className={styles.heading}>Sign in</h1>
                <p className={styles.lede}>
                    Keep the foods, recipes and plans you look at, on any device. No password: we&apos;ll email you a link.
                </p>
                {error && (
                    <div role="alert" className={`${styles.notice} ${styles.noticeWarning}`} style={{ marginTop: 16 }}>
                        <Icon name="alert" />
                        <span className={styles.noticeBody}>{error}</span>
                    </div>
                )}
                {options.available
                    ? <SignInForm next={next} consoleLinks={options.consoleLinks} google={options.google} />
                    : (
                        <div role="status" className={styles.notice} style={{ marginTop: 16 }}>
                            <Icon name="info" />
                            <span className={styles.noticeBody}>Sign-in isn&apos;t available right now. Everything else on the site works without an account.</span>
                        </div>
                    )}
                <p className={styles.note}>
                    We store your email and what you choose to keep here, and you can export or delete it at any time.
                    The whole site works without an account. <Link href="/">Continue without signing in</Link>
                </p>
            </section>
        </AccountFrame>
    );
}
