import Link from 'next/link';
import { redirect } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import { afterSignInPath } from '@/lib/auth/next-path';
import { getPageConsent } from '@/lib/consent-pages';
import { LEGAL_PATHS, MINIMUM_AGE, POLICY_TITLES, RETENTION, type PolicyKey } from '@/lib/legal';
import styles from './account.module.css';
import consentStyles from './consent.module.css';

const ORDER: PolicyKey[] = ['terms', 'privacy', 'healthData'];

const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/**
 * The account page's record of what this person agreed to, and where deleted data goes.
 * Kept out of AccountView so consent and billing work don't collide. An account with no
 * consent on record (it signed in some other way) is sent to the consent step first.
 */
export default async function AccountAgreements({ userId }: { userId: string }) {
    const consent = await getPageConsent(userId);
    if (consent.status === 'missing') redirect(afterSignInPath('/account'));
    const record = consent.record;

    return (
        <section className="panel" aria-labelledby="agreements-title" data-testid="account-agreements">
            <h2 id="agreements-title" className={styles.sectionTitle}>Your agreements and data</h2>
            {consent.status === 'outdated' && (
                <div role="status" className={`${styles.notice} ${styles.noticeWarning}`} style={{ marginTop: 12 }}>
                    <Icon name="info" />
                    <span className={styles.noticeBody}>
                        We&apos;ve updated our policies. <Link href={afterSignInPath('/account')}>Review and agree</Link>, or you&apos;ll be asked next time you sign in.
                    </span>
                </div>
            )}
            {record && (
                <dl className={consentStyles.agreements}>
                    <div className={consentStyles.pair}>
                        <dt>Agreed on</dt>
                        <dd data-testid="consent-agreed-at">{when(record.agreedAt)}</dd>
                    </div>
                    {ORDER.map(k => (
                        <div key={k} className={consentStyles.pair}>
                            <dt><Link href={LEGAL_PATHS[k]}>{POLICY_TITLES[k]}</Link></dt>
                            <dd>Version <span data-testid={`consent-version-${k}`}>{record.versions[k]}</span>{consent.changed.includes(k) ? ' (since updated)' : ''}</dd>
                        </div>
                    ))}
                    <div className={consentStyles.pair}>
                        <dt>Age</dt>
                        <dd>You confirmed you are {record.minimumAge || MINIMUM_AGE} or older</dd>
                    </div>
                </dl>
            )}
            <p className={styles.note} id="deletion-and-backups">
                Deleting your account removes it from our live database straight away. Copies stay in our backups for up to {RETENTION.backupsDays} days
                before they age out. <Link href={`${LEGAL_PATHS.privacy}#backups`}>How long we keep data</Link>. Deleting your account also withdraws your
                consent to <Link href={LEGAL_PATHS.healthData}>consumer health data</Link> processing.
            </p>
        </section>
    );
}
