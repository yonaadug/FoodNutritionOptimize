'use client';

import IntentLink from '@/components/ui/IntentLink';
import { useEffect, useRef, useState } from 'react';
import DraftNote from '@/components/legal/DraftNote';
import { primeCurrentUser, signOut, type CurrentUser } from '@/lib/auth/client';
import { LEGAL_PATHS, POLICY_TITLES, type PolicyKey } from '@/lib/legal';
import ConsentChecks, { focusFirstMissing, missingChoices, NO_CHOICES, sendConsent, type ConsentChoices, type ConsentKey } from './ConsentChecks';
import styles from './account.module.css';

const PREFIX = 'review-consent';
const ERROR_ID = 'review-consent-error';

/** Consent is on record: tell this browser who signed in, then go where they were heading. */
function continueTo(user: CurrentUser, next: string) {
    primeCurrentUser(user);
    window.location.replace(next);
}

/**
 * The step after a sign-in link or Google, when this account has no consent on record
 * for the current policies. If the boxes were ticked on the sign-in page in this browser
 * (`pending`), they're recorded without asking twice. Otherwise, as when the link was
 * opened in another browser or a policy has changed, it asks. Until then the browser
 * isn't told who signed in, so nothing is recorded to the account.
 */
export default function ConsentGate({ user, next, pending, status, changed }: {
    user: CurrentUser;
    next: string;
    pending: boolean;
    status: 'missing' | 'outdated';
    changed: PolicyKey[];
}) {
    const [mode, setMode] = useState<'recording' | 'asking'>(pending ? 'recording' : 'asking');
    const [choices, setChoices] = useState<ConsentChoices>(NO_CHOICES);
    const [missing, setMissing] = useState<ConsentKey[]>([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const started = useRef(false);

    const proceed = () => continueTo(user, next);

    useEffect(() => {
        if (!pending || started.current) return;
        started.current = true;
        void sendConsent('pending').then(result => {
            if (result.ok) continueTo(user, next);
            else setMode('asking');
        });
    }, [pending, user, next]);

    const agree = async (e: React.FormEvent) => {
        e.preventDefault();
        const gaps = missingChoices(choices);
        setMissing(gaps);
        if (gaps.length) {
            setError('Tick all three boxes to continue, or sign out.');
            focusFirstMissing(PREFIX, gaps);
            return;
        }
        setBusy(true);
        const result = await sendConsent(choices);
        if (result.ok) {
            proceed();
            return;
        }
        setBusy(false);
        setError(result.message);
    };

    const leave = async () => {
        setBusy(true);
        try {
            await signOut();
        } finally {
            window.location.replace('/');
        }
    };

    if (mode === 'recording') {
        return <p className={styles.lede} role="status"><span className="spinner" /> Taking you back…</p>;
    }

    return (
        <form className={styles.form} onSubmit={agree} data-testid="consent-gate">
            {status === 'outdated'
                ? (
                    <p className={styles.lede}>
                        We&apos;ve updated {changed.map((k, i) => (
                            <span key={k}>{i > 0 && (i === changed.length - 1 ? ' and ' : ', ')}our <IntentLink href={LEGAL_PATHS[k]} target="_blank">{POLICY_TITLES[k]}</IntentLink></span>
                        ))}. Please review and agree to keep using your account.
                    </p>
                )
                : <p className={styles.lede}>Before we open your account, please agree to the following.</p>}
            <ConsentChecks
                value={choices}
                onChange={c => { setChoices(c); if (missing.length) setMissing(missingChoices(c)); setError(''); }}
                missing={missing}
                idPrefix={PREFIX}
                legend="Your agreement"
                errorId={error ? ERROR_ID : undefined}
            />
            {error && <p id={ERROR_ID} role="alert" className={styles.fieldError} data-testid="consent-error">{error}</p>}
            <DraftNote compact />
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>Agree and continue</button>
            <button type="button" className="btn btn-ghost btn-block" onClick={leave} disabled={busy}>Sign out instead</button>
            <p className={styles.note}>Without these, you can still use the whole site signed out.</p>
        </form>
    );
}
