import { redirect } from 'next/navigation';
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
        </AccountFrame>
    );
}
