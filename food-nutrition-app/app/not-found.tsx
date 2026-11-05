import type { Metadata } from 'next';
import Link from 'next/link';
import Icon from '@/components/ui/Icon';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

export default function NotFound() {
    return (
        <main className="container food-page">
            <div className="empty-state panel">
                <div className="empty-icon"><Icon name="search" /></div>
                <h1 className="section-title">Page not found</h1>
                <p className="small" style={{ marginTop: 6 }}>That page doesn&apos;t exist, but the food you&apos;re after probably does.</p>
                <p style={{ marginTop: 16 }}><Link href="/" className="btn btn-primary">Search foods</Link></p>
            </div>
        </main>
    );
}
