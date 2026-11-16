'use client';

import IntentLink from '@/components/ui/IntentLink';
import { usePathname } from 'next/navigation';
import { signInPath } from '@/lib/auth/next-path';
import { PHOTO_LIMITS, TRIAL_DAYS } from '@/lib/billing/entitlements';
import { quotaMessage } from '@/lib/billing/quota';
import { usePlus } from './usePlus';
import styles from './billing.module.css';

/**
 * Wraps the photo buttons on /recipes. Signed out, it asks for a free account (photo reads
 * are counted per account). With reads left it shows the buttons and a quiet count. With
 * none left it shows when they come back instead of the buttons. Pasted text is untouched.
 */
export default function PhotoQuota({ children }: { children: React.ReactNode }) {
    const { loading, signedIn, plan } = usePlus();
    const pathname = usePathname() ?? '/recipes';
    if (loading) return <>{children}</>;
    if (!signedIn) {
        return (
            <div className={styles.gate + ' ' + styles.gateCompact} data-testid="photo-sign-in">
                <p className={styles.gateText}>
                    Photo reads need a free account: {PHOTO_LIMITS.trial.limit} in your first {TRIAL_DAYS} days, then {PHOTO_LIMITS.free.limit} a month.
                </p>
                <div className={styles.gateActions}>
                    <IntentLink href={signInPath(pathname)} className="btn btn-primary-soft btn-sm">Sign in to use a photo</IntentLink>
                </div>
            </div>
        );
    }
    const photo = plan?.photo;
    if (!photo) return <>{children}</>;
    if (photo.remaining <= 0) {
        return (
            <div className={styles.gate + ' ' + styles.gateCompact} data-testid="photo-quota-gate">
                <p className={styles.gateText}>{quotaMessage(photo, plan.plan)}</p>
                <div className={styles.gateActions}>
                    {plan.plan !== 'plus' && <IntentLink href="/plus" className="btn btn-secondary btn-sm">See what Plus adds</IntentLink>}
                </div>
                <p className={styles.inline}>You can still paste the recipe as text.</p>
            </div>
        );
    }
    return (
        <>
            {children}
            <p className={styles.inline} data-testid="photo-quota-left">
                {photo.remaining} of {photo.limit} photo {photo.limit === 1 ? 'read' : 'reads'} left {photo.period === 'trial' ? 'in your trial' : 'this month'}.
            </p>
        </>
    );
}
