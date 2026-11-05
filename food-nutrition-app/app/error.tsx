'use client';

import Icon from '@/components/ui/Icon';

/** Shown when a server-rendered page fails (for example the database can't be read). */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <main className="container food-page">
            <div className="callout callout-danger" role="alert">
                <span className="callout-icon"><Icon name="alert" /></span>
                <div className="stack" style={{ gap: 8 }}>
                    <span><span className="callout-title">Something went wrong loading this page.</span> Please try again in a moment.</span>
                    <div><button type="button" className="btn btn-secondary btn-sm" onClick={reset}><Icon name="refresh" size={14} /> Try again</button></div>
                </div>
            </div>
        </main>
    );
}
