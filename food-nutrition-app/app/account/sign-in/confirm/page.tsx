import type { Metadata } from 'next';
import Link from 'next/link';
import AccountFrame from '@/components/account/AccountFrame';
import styles from '@/components/account/account.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Finish signing in · Micronutrient Diary',
    // The URL holds a sign-in token: don't let it travel in a Referer header.
    referrer: 'no-referrer',
};

const FORWARDED_PARAMS = ['token', 'callbackURL', 'errorCallbackURL', 'newUserCallbackURL'] as const;

/**
 * Where the email link lands. Security scanners in mail systems open links to check
 * them, and that would use up a one-time link before its owner gets there. They don't
 * press buttons, so the token is only spent when this form is submitted. It uses no
 * JavaScript, and Better Auth validates every forwarded value at the endpoint.
 */
export default async function ConfirmSignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const values = FORWARDED_PARAMS
        .map(name => [name, params[name]] as const)
        .filter((entry): entry is readonly [typeof FORWARDED_PARAMS[number], string] => typeof entry[1] === 'string' && entry[1] !== '');
    const hasToken = values.some(([name]) => name === 'token');

    return (
        <AccountFrame narrow>
            <section className="panel" aria-labelledby="confirm-title">
                {hasToken
                    ? (
                        <>
                            <h1 id="confirm-title" className={styles.heading}>Finish signing in</h1>
                            <p className={styles.lede}>Press the button to sign in to Micronutrient Diary on this device.</p>
                            <form method="get" action="/api/auth/magic-link/verify" className={styles.form}>
                                {values.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
                                <button type="submit" className="btn btn-primary btn-lg btn-block">Sign in</button>
                            </form>
                            <p className={styles.note}>If you didn&apos;t ask to sign in, you can close this page. Nothing happens unless you press the button.</p>
                        </>
                    )
                    : (
                        <>
                            <h1 id="confirm-title" className={styles.heading}>That link isn&apos;t complete</h1>
                            <p className={styles.lede}>It may have been cut off by your email app. <Link href="/account/sign-in">Request a new sign-in link</Link>.</p>
                        </>
                    )}
            </section>
        </AccountFrame>
    );
}
