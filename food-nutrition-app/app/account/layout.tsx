import type { Metadata } from 'next';

/** Personal pages: nothing here should appear in search results. */
export const metadata: Metadata = {
    title: 'Account · Micronutrient Diary',
    robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
    return children;
}
