import type { Metadata } from 'next';
import Link from 'next/link';
import PlusActions from '@/components/billing/PlusActions';
import styles from '@/components/billing/billing.module.css';
import Icon from '@/components/ui/Icon';
import { getPageUser } from '@/lib/auth/pages';
import { FREE_HISTORY_LIMIT, PHOTO_LIMITS, PRICES, TRIAL_DAYS } from '@/lib/billing/entitlements';
import { ALWAYS_FREE, FEATURE_COPY, FEATURE_ORDER } from '@/lib/billing/features';
import { loadStripeConfig } from '@/lib/billing/stripe-config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Plus',
    description: `NutritionDictionary Plus: a week planner with a grocery list, a contaminant check across a whole plan, ${PHOTO_LIMITS.plus.limit} AI photo reads a month and all your saved plans on every device. ${PRICES.month.label}/month or ${PRICES.year.label}/year.`,
    alternates: { canonical: '/plus' },
};

export default async function PlusPage() {
    const user = await getPageUser();
    const plan = user?.plan ?? null;
    const billingAvailable = plan ? plan.billingAvailable : loadStripeConfig().ok;

    return (
        <main className={`container ${styles.page}`}>
            <header className={styles.hero}>
                <p className="eyebrow">NutritionDictionary Plus</p>
                <h1 className={styles.heroTitle}>Plan your whole week</h1>
                <p className={styles.heroText}>
                    Plus adds planning over time and more AI help. Everything you use today stays free.
                </p>
            </header>

            <PlusActions initial={plan} signedIn={Boolean(user)} billingAvailable={billingAvailable} />

            <div className={styles.columns}>
                <section className="panel" aria-labelledby="adds-title">
                    <h2 id="adds-title" className="panel-title">What Plus adds</h2>
                    <ul className={styles.list}>
                        {FEATURE_ORDER.map(f => (
                            <li key={f} className={styles.listItem}>
                                <Icon name="sparkle" />
                                <div>
                                    <p className={styles.listName}>{FEATURE_COPY[f].name}</p>
                                    <p className={styles.listWhat}>{FEATURE_COPY[f].what}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
                <section className="panel" aria-labelledby="free-title">
                    <h2 id="free-title" className="panel-title">Always free</h2>
                    <ul className={styles.freeList}>
                        {ALWAYS_FREE.map(item => <li key={item}><Icon name="check" size={16} />{item}</li>)}
                    </ul>
                    <p className={styles.note}>
                        A free account also gets {PHOTO_LIMITS.free.limit} photo reads a month and keeps your newest {FREE_HISTORY_LIMIT} plans and recipes on every device.
                    </p>
                </section>
            </div>

            <section className="panel" aria-labelledby="faq-title">
                <h2 id="faq-title" className="panel-title">Good to know</h2>
                <div className={styles.faq} style={{ marginTop: 12 }}>
                    <div>
                        <h3>How does the trial work?</h3>
                        <p>
                            Every new account gets {TRIAL_DAYS} days of Plus, with no card, including {PHOTO_LIMITS.trial.limit} photo reads.
                            When it ends you move to the free plan. Nothing is charged unless you subscribe.
                        </p>
                    </div>
                    <div>
                        <h3>What happens to my plans if I stop?</h3>
                        <p>
                            Nothing is deleted. The free plan shows your newest {FREE_HISTORY_LIMIT} plans and recipes, and the rest come back if you subscribe again.
                            Your data export always includes everything.
                        </p>
                    </div>
                    <div>
                        <h3>How do I cancel?</h3>
                        <p>
                            Open <Link href="/account">your account</Link> and choose Manage subscription. You keep Plus until the end of the period you paid for.
                            Payments and receipts are handled by Stripe.
                        </p>
                    </div>
                </div>
            </section>
        </main>
    );
}
