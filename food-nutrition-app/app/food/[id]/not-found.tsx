import type { Metadata } from 'next';
import IntentLink from '@/components/ui/IntentLink';
import Icon from '@/components/ui/Icon';

export const metadata: Metadata = { title: 'Food not found', robots: { index: false } };

export default function FoodNotFound() {
    return (
        <main className="container food-page">
            <div className="empty-state panel">
                <div className="empty-icon"><Icon name="search" /></div>
                <h1 className="section-title">We don&apos;t have that food</h1>
                <p className="small" style={{ marginTop: 6 }}>The link may be out of date. USDA IDs can change between data releases.</p>
                <p style={{ marginTop: 16 }}><IntentLink href="/" className="btn btn-primary">Search all foods</IntentLink></p>
            </div>
        </main>
    );
}
