'use client';

import IntentLink from '@/components/ui/IntentLink';
import { useEffect, useState } from 'react';
import { refreshCurrentUser } from '@/lib/auth/client';
import { signInPath } from '@/lib/auth/next-path';
import { usePlus } from './usePlus';
import styles from './billing.module.css';

const POLL_MS = 2_000;
const GIVE_UP_MS = 40_000;

/**
 * After Stripe Checkout. The webhook, not this page, turns Plus on, so this only waits
 * for it and says so plainly.
 */
export default function WelcomeStatus() {
    const { plan, loading, signedIn } = usePlus();
    const [waitedTooLong, setWaitedTooLong] = useState(false);
    const isPlus = plan?.plan === 'plus';

    useEffect(() => {
        if (isPlus) return;
        const started = Date.now();
        const timer = window.setInterval(() => {
            if (Date.now() - started > GIVE_UP_MS) {
                setWaitedTooLong(true);
                window.clearInterval(timer);
                return;
            }
            void refreshCurrentUser();
        }, POLL_MS);
        return () => window.clearInterval(timer);
    }, [isPlus]);

    if (!loading && !signedIn) {
        return (
            <div className="panel" role="status">
                <h1 className={styles.planTitle}>Thanks for subscribing</h1>
                <p className={styles.planText}>Sign in with the same email to use Plus.</p>
                <div className={styles.actions}><IntentLink href={signInPath('/account')} className="btn btn-primary">Sign in</IntentLink></div>
            </div>
        );
    }

    return (
        <div className="panel" role="status" aria-live="polite" data-testid="welcome-status" data-plus={isPlus || undefined}>
            <h1 className={styles.planTitle}>{isPlus ? 'Welcome to Plus' : 'Payment received. Finishing setup…'}</h1>
            <p className={styles.planText}>
                {isPlus
                    ? 'The week planner, the whole-plan contaminant check, more photo reads and all your saved plans are ready.'
                    : waitedTooLong
                        ? 'This is taking longer than usual. Your plan updates on its own within a few minutes; check your account page then.'
                        : 'This usually takes a few seconds.'}
            </p>
            <div className={styles.actions}>
                <IntentLink href="/plan" className={`btn ${isPlus ? 'btn-primary' : 'btn-secondary'}`}>Make a plan</IntentLink>
                <IntentLink href="/account" className="btn btn-secondary">Your account</IntentLink>
            </div>
        </div>
    );
}
