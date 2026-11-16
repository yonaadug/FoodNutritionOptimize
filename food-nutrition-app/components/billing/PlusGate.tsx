'use client';

import IntentLink from '@/components/ui/IntentLink';
import { usePathname } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import { signInPath } from '@/lib/auth/next-path';
import { PRICES, TRIAL_DAYS, type Feature } from '@/lib/billing/entitlements';
import { FEATURE_COPY } from '@/lib/billing/features';
import { usePlus } from './usePlus';
import styles from './billing.module.css';

interface Props {
    feature: Feature;
    children: React.ReactNode;
    /** Replaces the standard locked card. */
    fallback?: React.ReactNode;
    /** Shown while we don't yet know who is signed in. Defaults to nothing. */
    loading?: React.ReactNode;
    /** A smaller card, for a gate inside a panel. */
    compact?: boolean;
}

/**
 * Shows `children` when the plan includes `feature`, and a calm locked card otherwise.
 * Wrapping a feature is one line:
 *
 *   // PLUS-GATE: weekPlanner
 *   <PlusGate feature="weekPlanner"><WeekPlanner /></PlusGate>
 *
 * This only hides the UI. Any API route doing the work checks too, with requireFeature
 * or plusRoute (lib/billing/gate.ts, lib/billing/server.ts).
 */
export default function PlusGate({ feature, children, fallback, loading = null, compact = false }: Props) {
    const plus = usePlus();
    if (plus.loading) return <>{loading}</>;
    if (plus.has(feature)) return <>{children}</>;
    if (fallback !== undefined) return <>{fallback}</>;
    return <PlusLocked feature={feature} signedIn={plus.signedIn} compact={compact} />;
}

/** The locked state on its own, for pages that render their own layout around it. */
export function PlusLocked({ feature, signedIn, compact = false }: { feature: Feature; signedIn: boolean; compact?: boolean }) {
    const pathname = usePathname() ?? '/';
    const copy = FEATURE_COPY[feature];
    return (
        <section className={`${styles.gate} ${compact ? styles.gateCompact : ''}`} aria-label={`${copy.name} is part of Plus`} data-testid="plus-gate">
            <p className={styles.gateTitle}><Icon name="sparkle" size={18} />{copy.name} is part of Plus</p>
            <p className={styles.gateText}>{copy.what}</p>
            <p className={styles.gateText}>
                {signedIn
                    ? `Plus is ${PRICES.month.label} a month or ${PRICES.year.label} a year.`
                    : `New accounts get ${TRIAL_DAYS} days of Plus free, with no card.`}
            </p>
            <div className={styles.gateActions}>
                {!signedIn && <IntentLink href={signInPath(pathname)} className="btn btn-primary btn-sm">Sign in to try it</IntentLink>}
                <IntentLink href="/plus" className={`btn btn-sm ${signedIn ? 'btn-primary' : 'btn-secondary'}`}>See what Plus adds</IntentLink>
            </div>
        </section>
    );
}
