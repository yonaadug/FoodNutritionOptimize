import { redirect } from 'next/navigation';
import AccountAgreements from '@/components/account/AccountAgreements';
import AccountFrame from '@/components/account/AccountFrame';
import AccountView from '@/components/account/AccountView';
import { getPageUser } from '@/lib/auth/pages';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
    const user = await getPageUser();
    if (!user) redirect('/account/sign-in');
    return (
        <AccountFrame>
            <AccountView user={user} />
            {/* Consent record and backup retention, next to the delete section (lib/consent.ts). */}
            <AccountAgreements userId={user.id} />
        </AccountFrame>
    );
}
