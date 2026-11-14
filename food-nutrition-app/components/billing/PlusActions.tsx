'use client';

import Link from 'next/link';
import { useState } from 'react';
import { signInPath } from '@/lib/auth/next-path';
import { PRICES, TRIAL_DAYS, type Interval } from '@/lib/billing/entitlements';
import type { PlanSummary } from '@/lib/billing/types';
import { ManageSubscriptionButton, planDate } from './PlanSection';
import { startCheckout, usePlus } from './usePlus';
import styles from './billing.module.css';

const SAVING = Math.round((1 - PRICES.year.amount / (PRICES.month.amount * 12)) * 100);

/** The price, the monthly/yearly choice and the one button that fits this person's plan. */
export default function PlusActions({ initial, signedIn: signedInOnServer, billingAvailable }: {
    initial: PlanSummary | null;
    signedIn: boolean;
    billingAvailable: boolean;
}) {
    const live = usePlus();
    const plan = live.plan ?? initial;
    const signedIn = live.loading ? signedInOnServer : live.signedIn;
    const [interval, setPeriod] = useState<Interval>(plan?.subscription?.interval ?? 'year');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const price = PRICES[interval];

    const subscribe = async () => {
        setBusy(true);
        setError('');
        try {
            await startCheckout(interval);
        } catch (e) {
            setError((e as Error).message);
            setBusy(false);
        }
    };

    const sub = plan?.subscription;
    let action: React.ReactNode;
    let status: string | null = null;
    if (!signedIn) {
        action = <Link href={signInPath('/plus')} className="btn btn-primary btn-lg">Sign in to start your free trial</Link>;
        status = `New accounts get ${TRIAL_DAYS} days of Plus free. No card needed.`;
    } else if (plan?.plan === 'plus') {
        action = <ManageSubscriptionButton primary />;
        status = sub?.currentPeriodEnd
            ? sub.cancelAtPeriodEnd ? `You have Plus until ${planDate(sub.currentPeriodEnd)}.` : `You have Plus. It renews on ${planDate(sub.currentPeriodEnd)}.`
            : 'You have Plus.';
    } else if (!billingAvailable) {
        action = <button type="button" className="btn btn-primary btn-lg" disabled>Get Plus</button>;
        status = 'Billing isn\'t set up on this site yet, so upgrades are off.';
    } else {
        action = (
            <button type="button" className="btn btn-primary btn-lg" onClick={subscribe} disabled={busy} data-testid="subscribe">
                {busy ? 'Opening checkout…' : `Get Plus for ${price.label} a ${price.per}`}
            </button>
        );
        if (plan?.plan === 'trial') status = `Your trial has ${plan.trial.daysLeft} ${plan.trial.daysLeft === 1 ? 'day' : 'days'} left. Subscribing starts billing today.`;
        else if (plan?.hasBillingAccount) status = 'Welcome back. Checkout is on Stripe, and you can cancel any time.';
        else status = 'Checkout is on Stripe. Cancel any time from your account.';
    }

    const showChoice = !(signedIn && plan?.plan === 'plus');

    return (
        <div className={`panel ${styles.priceCard}`}>
            {showChoice && (
                <div className="segmented" role="tablist" aria-label="Billing period">
                    {(['month', 'year'] as const).map(i => (
                        <button key={i} type="button" role="tab" aria-selected={interval === i} onClick={() => setPeriod(i)}>
                            {i === 'month' ? 'Monthly' : `Yearly · save ${SAVING}%`}
                        </button>
                    ))}
                </div>
            )}
            <p><span className={styles.price}>{price.label}</span> <span className={styles.pricePer}>/ {price.per}</span></p>
            <p className={styles.priceSub}>{interval === 'year' ? `That's $${(PRICES.year.amount / 12).toFixed(2)} a month, billed once a year.` : 'Billed monthly.'}</p>
            <div className={styles.ctaRow}>{action}</div>
            {status && <p className={styles.priceSub} role="status">{status}</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
    );
}
