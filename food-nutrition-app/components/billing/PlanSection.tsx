'use client';

import Link from 'next/link';
import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import { FREE_HISTORY_LIMIT, PHOTO_LIMITS } from '@/lib/billing/entitlements';
import type { PlanSummary } from '@/lib/billing/types';
import { openPortal, usePlus } from './usePlus';
import styles from './billing.module.css';

/** Dates in UTC, so the server and the browser render the same text. */
export const planDate = (iso: string, withYear = true) => new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
});

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export function photoLine(photo: PlanSummary['photo']): string {
    if (photo.period === 'trial') return `${photo.used} of ${photo.limit} used in your trial`;
    return `${photo.used} of ${photo.limit} used this month`;
}

/** "Manage subscription": opens the Stripe Customer Portal. */
export function ManageSubscriptionButton({ primary = false }: { primary?: boolean }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const open = async () => {
        setBusy(true);
        setError('');
        try {
            await openPortal();
        } catch (e) {
            setError((e as Error).message);
            setBusy(false);
        }
    };
    return (
        <>
            <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={open} disabled={busy}>
                {busy ? 'Opening…' : 'Manage subscription'}
            </button>
            {error && <p className={styles.error} role="alert">{error}</p>}
        </>
    );
}

/** The plan panel on /account: trial days left, renewal or end date, photo reads, and the way to change it. */
export default function PlanSection({ initial }: { initial: PlanSummary | null | undefined }) {
    const live = usePlus();
    const plan = live.plan ?? initial;
    if (!plan) return null;
    const sub = plan.subscription;

    let badge = 'Free';
    let title = 'Free plan';
    let text: React.ReactNode = `Plus adds the week planner, the whole-plan contaminant check, ${PHOTO_LIMITS.plus.limit} photo reads a month, and all your saved plans and recipes.`;
    if (plan.plan === 'trial') {
        badge = 'Trial';
        title = `Plus trial: ${days(plan.trial.daysLeft)} left`;
        text = `Your trial ends on ${planDate(plan.trial.endsAt)}. After that you keep everything you've saved, and the free plan shows your newest ${FREE_HISTORY_LIMIT} plans and recipes. No card needed.`;
    } else if (plan.plan === 'plus') {
        badge = 'Plus';
        title = `Plus${sub?.interval === 'year' ? ', yearly' : sub?.interval === 'month' ? ', monthly' : ''}`;
        if (sub?.currentPeriodEnd) {
            text = sub.cancelAtPeriodEnd
                ? `Your subscription ends on ${planDate(sub.currentPeriodEnd)}. You keep Plus until then.`
                : `Renews on ${planDate(sub.currentPeriodEnd)}.`;
        } else text = 'Thanks for supporting NutritionDictionary.';
    }

    const fill = plan.photo.limit ? Math.min(100, Math.round((plan.photo.used / plan.photo.limit) * 100)) : 0;

    return (
        <section className="panel" aria-labelledby="plan-title" data-testid="plan-section" data-plan={plan.plan}>
            <div className={styles.planHead}>
                <h2 id="plan-title" className={styles.planTitle}>{title}</h2>
                <span className={`${styles.badge} ${plan.plan === 'free' ? styles.badgeFree : ''}`}>{badge}</span>
            </div>
            <p className={styles.planText}>{text}</p>

            {sub?.paymentProblem && plan.hasBillingAccount && (
                <div className="callout callout-warn" style={{ marginTop: 16 }} role="status">
                    <span className="callout-icon"><Icon name="alert" /></span>
                    <span>Your last payment didn&apos;t go through. Update your card under Manage subscription to keep Plus.</span>
                </div>
            )}

            <div className={styles.facts}>
                <div className={styles.fact}>
                    <p className={styles.factLabel}>AI photo reads</p>
                    <p className={styles.factValue} data-testid="photo-usage">{photoLine(plan.photo)}</p>
                    <div className={styles.meter} aria-hidden="true"><div className={styles.meterFill} style={{ width: `${fill}%` }} /></div>
                </div>
                <div className={styles.fact}>
                    <p className={styles.factLabel}>Saved plans and recipes</p>
                    <p className={styles.factValue}>{plan.historyLimit === null ? 'All of them, on every device' : `Your newest ${plan.historyLimit} of each`}</p>
                </div>
            </div>

            <div className={styles.actions}>
                {plan.plan === 'plus' || plan.hasBillingAccount
                    ? <ManageSubscriptionButton primary={plan.plan === 'plus'} />
                    : null}
                {plan.plan !== 'plus' && (
                    <Link href="/plus" className={`btn ${plan.hasBillingAccount ? 'btn-secondary' : 'btn-primary'}`}>
                        {plan.plan === 'trial' ? 'Keep Plus after the trial' : 'See what Plus adds'}
                    </Link>
                )}
            </div>
            {!plan.billingAvailable && plan.plan !== 'plus' && (
                <p className={styles.note}>Billing isn&apos;t set up on this site yet, so upgrades are off.</p>
            )}
        </section>
    );
}
