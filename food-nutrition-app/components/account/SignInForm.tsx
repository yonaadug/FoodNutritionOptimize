'use client';

import { useRef, useState } from 'react';
import DraftNote from '@/components/legal/DraftNote';
import Icon from '@/components/ui/Icon';
import { apiFetch, requestSignInLink } from '@/lib/auth/client';
import { afterSignInPath, signInPath } from '@/lib/auth/next-path';
import ConsentChecks, { focusFirstMissing, missingChoices, NO_CHOICES, sendConsent, type ConsentChoices, type ConsentKey } from './ConsentChecks';
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

const CONSENT_PREFIX = 'sign-in-consent';
const CONSENT_ERROR_ID = 'sign-in-consent-error';
/** The server refuses to start a sign-in without the consent cookie (lib/consent-http.ts). */
const COOKIE_BLOCKED = 'Your browser didn\'t keep the cookie that records your choices. Allow cookies for this site and try again.';

export default function SignInForm({ next, consoleLinks, google }: Props) {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<Status>({ state: 'idle' });
    const [choices, setChoices] = useState<ConsentChoices>(NO_CHOICES);
    const [missing, setMissing] = useState<ConsentKey[]>([]);
    const [consentError, setConsentError] = useState('');
    const input = useRef<HTMLInputElement>(null);

    const changeChoices = (nextChoices: ConsentChoices) => {
        setChoices(nextChoices);
        if (missing.length) setMissing(missingChoices(nextChoices));
        setConsentError('');
    };

    /**
     * Nothing is emailed, and Google isn't contacted, until all three boxes are ticked and
     * the server has them. Returns whether sign-in may go ahead.
     */
    const consentFirst = async (): Promise<boolean> => {
        const gaps = missingChoices(choices);
        setMissing(gaps);
        if (gaps.length) {
            setConsentError(gaps.length === 1 && gaps[0] === 'healthDataConsent'
                ? 'Tick the consumer health data box to continue. An account can\'t keep your history without it.'
                : 'Tick all three boxes to continue.');
            focusFirstMissing(CONSENT_PREFIX, gaps);
            return false;
        }
        const sent = await sendConsent(choices);
        if (!sent.ok) {
            setConsentError(sent.message);
            return false;
        }
        setConsentError('');
        return true;
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const address = email.trim();
        setStatus({ state: 'sending' });
        if (!(await consentFirst())) {
            setStatus({ state: 'idle' });
            return;
        }
        try {
            const code = await requestSignInLink(address, next);
            if (code >= 200 && code < 300) setStatus({ state: 'sent', email: address });
            else if (code === 429) setStatus({ state: 'error', message: 'Too many sign-in requests. Please wait a few minutes and try again.' });
            else if (code === 400) setStatus({ state: 'error', message: 'That doesn\'t look like an email address.' });
            else if (code === 403) setStatus({ state: 'error', message: COOKIE_BLOCKED });
            else setStatus({ state: 'error', message: 'We couldn\'t send your link just now. Please try again.' });
        } catch {
            setStatus({ state: 'error', message: 'We couldn\'t reach the server. Check your connection and try again.' });
        }
        if (input.current && document.activeElement !== input.current) input.current.focus();
    };

    const signInWithGoogle = async () => {
        setStatus({ state: 'sending' });
        if (!(await consentFirst())) {
            setStatus({ state: 'idle' });
            return;
        }
        try {
            const res = await apiFetch('/api/auth/sign-in/social', {
                method: 'POST',
                json: { provider: 'google', callbackURL: afterSignInPath(next), errorCallbackURL: signInPath(next) },
            });
            if (res.status === 403) {
                setStatus({ state: 'error', message: COOKIE_BLOCKED });
                return;
            }
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
                <ConsentChecks
                    value={choices}
                    onChange={changeChoices}
                    missing={missing}
                    idPrefix={CONSENT_PREFIX}
                    legend="Before you sign in"
                    errorId={consentError ? CONSENT_ERROR_ID : undefined}
                />
                {consentError && <p id={CONSENT_ERROR_ID} role="alert" className={styles.fieldError} data-testid="consent-error">{consentError}</p>}
                <DraftNote compact />
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
