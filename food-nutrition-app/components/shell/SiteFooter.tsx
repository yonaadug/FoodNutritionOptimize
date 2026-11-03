'use client';

import { useEffect, useState } from 'react';

interface MetaInfo { foodCount: number; release: string | null; downloadPage: string | null }

function latestRelease(sourcesJson: string | undefined): string | null {
    if (!sourcesJson) return null;
    try {
        const sources = JSON.parse(sourcesJson) as { release?: string }[];
        const dates = sources.map(s => s.release).filter((r): r is string => !!r).sort();
        const last = dates[dates.length - 1];
        if (!last) return null;
        const d = new Date(last.length === 7 ? `${last}-01` : last);
        return Number.isNaN(d.getTime()) ? last : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
    } catch {
        return null;
    }
}

/** Data provenance footer, e.g. "9,435 foods · USDA FoodData Central, Oct 2026". */
export default function SiteFooter() {
    const [info, setInfo] = useState<MetaInfo | null>(null);

    useEffect(() => {
        const ctrl = new AbortController();
        (async () => {
            try {
                const res = await fetch('/api/meta', { signal: ctrl.signal });
                if (!res.ok) return;
                const data = await res.json();
                setInfo({
                    foodCount: Number(data.foodCount ?? 0),
                    release: latestRelease(data.meta?.sources),
                    downloadPage: typeof data.meta?.download_page === 'string' ? data.meta.download_page : null,
                });
            } catch { /* footer is optional */ }
        })();
        return () => ctrl.abort();
    }, []);

    return (
        <footer className="container site-footer small muted">
            <p>
                {info?.foodCount ? `${info.foodCount.toLocaleString()} foods · ` : ''}
                Nutrition data from{' '}
                <a href={info?.downloadPage ?? 'https://fdc.nal.usda.gov/'} target="_blank" rel="noreferrer">USDA FoodData Central</a>
                {info?.release ? `, ${info.release}` : ''} (public domain).
            </p>
            <p>Plans are estimates for general information, not medical advice.</p>
        </footer>
    );
}
