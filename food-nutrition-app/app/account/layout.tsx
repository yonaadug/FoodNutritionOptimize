import type { Metadata } from 'next';
import { SITE_NAME } from '@/lib/nav';

/** Personal pages: nothing here should appear in search results. */
export const metadata: Metadata = {
    title: { default: 'Account', template: `%s | ${SITE_NAME}` },
    robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
    return children;
}
