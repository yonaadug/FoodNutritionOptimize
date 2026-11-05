import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AccountFrame from '@/components/account/AccountFrame';
import { PrimeUser } from '@/components/account/AccountView';
import HistoryView from '@/components/account/HistoryView';
import styles from '@/components/account/account.module.css';
import { getPageUser } from '@/lib/auth/pages';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'History · Micronutrient Diary' };

export default async function HistoryPage() {
    const user = await getPageUser();
    if (!user) redirect('/account/sign-in?next=/account/history');
    return (
        <AccountFrame>
            <PrimeUser user={user} />
            <div>
                <h1 className={styles.heading}>Your history</h1>
                <p className={styles.lede}>
                    The foods, recipes and plans you&apos;ve looked at. <Link href="/account">Back to your account</Link>
                </p>
            </div>
            <HistoryView />
        </AccountFrame>
    );
}
