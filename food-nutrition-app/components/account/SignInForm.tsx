'use client';

import { useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { apiFetch, requestSignInLink } from '@/lib/auth/client';
import styles from './account.module.css';

type Status =
    | { state: 'idle' }
    | { state: 'sending' }
    | { state: 'sent'; email: string }
    | { state: 'error'; message: string };

interface Props {
    next: string;
    consoleLinks: boolean;
    google: boolean;
}

export default function SignInForm({ next, consoleLinks, google }: Props) {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<Status>({ state: 'idle' });
    const input = useRef<HTMLInputElement>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const address = email.trim();
        setStatus({ state: 'sending' });
        try {
            const code = await requestSignInLink(address, next);
            if (code >= 200 && code < 300) setStatus({ state: 'sent', email: address });
            else if (code === 429) setStatus({ state: 'error', message: 'Too many sign-in requests. Please wait a few minutes and try again.' });
            else if (code === 400) setStatus({ state: 'error', message: 'That doesn\'t look like an email address.' });
            else setStatus({ state: 'error', message: 'We couldn\'t send your link just now. Please try again.' });
        } catch {
            setStatus({ state: 'error', message: 'We couldn\'t reach the server. Check your connection and try again.' });
        }
        if (input.current && document.activeElement !== input.current) input.current.focus();
    };

    const signInWithGoogle = async () => {
        setStatus({ state: 'sending' });
        try {
            const res = await apiFetch('/api/auth/sign-in/social', {
                method: 'POST',
                json: { provider: 'google', callbackURL: next, errorCallbackURL: '/account/sign-in' },
            });
            const { url } = (await res.json()) as { url?: string };
            if (!res.ok || !url) throw new Error('no url');
            window.location.assign(url);
        } catch {
            setStatus({ state: 'error', message: 'Google sign-in isn\'t available just now. You can use your email instead.' });
        }
    };

    if (status.state === 'sent') {
        return (
            <div role="status" className="stack">
                <div className={`${styles.notice} ${styles.noticeSuccess}`}>
                    <Icon name="check" />
                    <div className={styles.noticeBody}>
                        {consoleLinks
                            ? <><strong>Check the terminal for your link.</strong> This site is running locally, so nothing was emailed. The sign-in link is in the server&apos;s output.</>
                            : <><strong>Check your email.</strong> If that address can receive mail, a sign-in link is on its way to {status.email}. It works once and expires in 15 minutes.</>}
                    </div>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => setStatus({ state: 'idle' })}>Use a different email</button>
            </div>
        );
    }

    const sending = status.state === 'sending';
    return (
        <>
            <form className={styles.form} onSubmit={submit}>
                <div className="field">
                    <label className="field-label" htmlFor="sign-in-email">Email address</label>
                    <input
                        ref={input}
                        id="sign-in-email"
                        className="input"
                        type="email"
                        name="email"
                        autoComplete="email"
                        inputMode="email"
                        required
                        maxLength={254}
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        aria-describedby={status.state === 'error' ? 'sign-in-error' : undefined}
                    />
                </div>
                {status.state === 'error' && <p id="sign-in-error" role="alert" className={styles.fieldError}>{status.message}</p>}
                <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={sending}>
                    {sending ? <><span className="spinner" /> Sending…</> : 'Email me a sign-in link'}
                </button>
            </form>
            {consoleLinks && !sending && (
                <p className={styles.note}>Running locally: the link is printed in the terminal instead of being emailed.</p>
            )}
            {google && (
                <>
                    <div className={styles.divider}>or</div>
                    <button type="button" className="btn btn-secondary btn-block" onClick={signInWithGoogle} disabled={sending}>Continue with Google</button>
                </>
            )}
        </>
    );
}
