import type { Metadata } from 'next';
import WelcomeStatus from '@/components/billing/WelcomeStatus';
import styles from '@/components/billing/billing.module.css';

export const metadata: Metadata = {
    title: 'Welcome to Plus',
    robots: { index: false, follow: false },
};

/** Stripe Checkout's success_url. The session_id in the address is not used: the webhook is the source of truth. */
export default function PlusWelcomePage() {
    return (
        <main className={`container ${styles.page}`} style={{ maxWidth: 560 }}>
            <WelcomeStatus />
        </main>
    );
}
