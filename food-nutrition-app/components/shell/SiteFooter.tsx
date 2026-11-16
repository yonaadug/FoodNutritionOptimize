import IntentLink from '@/components/ui/IntentLink';
import { getDbInfo, getMeta } from '@/lib/db';
import { LEGAL_DRAFT, LEGAL_PATHS } from '@/lib/legal';
import styles from './SiteFooter.module.css';

interface MetaInfo { foodCount: number; release: string | null; downloadPage: string | null }

function latestRelease(sourcesJson: string | undefined): string | null {
    if (!sourcesJson) return null;
    try {
        const sources = JSON.parse(sourcesJson) as { release?: string }[];
        const dates = sources.map(s => s.release).filter((r): r is string => !!r).sort();
        const last = dates[dates.length - 1];
        if (!last) return null;
        const d = new Date(last.length === 7 ? `${last}-01` : last);
        return Number.isNaN(d.getTime()) ? last : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    } catch {
        return null;
    }
}

/** What the footer says about the data. The footer is optional, so a database problem just leaves it out. */
function readMeta(): MetaInfo | null {
    try {
        const meta = getMeta();
        return {
            foodCount: getDbInfo().foodCount,
            release: latestRelease(meta?.sources),
            downloadPage: typeof meta?.download_page === 'string' ? meta.download_page : null,
        };
    } catch {
        return null;
    }
}

/**
 * Data provenance footer, e.g. "9,435 foods · USDA FoodData Central, Oct 2026".
 * Rendered on the server, so it's in the page from the first paint (no request after
 * load, no text appearing later, and no JavaScript).
 */
export default function SiteFooter() {
    const info = readMeta();
    return (
        <footer className="container site-footer small muted">
            <p>
                {info?.foodCount ? `${info.foodCount.toLocaleString('en-US')} foods · ` : ''}
                Nutrition data from{' '}
                <a href={info?.downloadPage ?? 'https://fdc.nal.usda.gov/'} target="_blank" rel="noreferrer">USDA FoodData Central</a>
                {info?.release ? `, ${info.release}` : ''} (public domain).{' '}
                <IntentLink href="/methodology">How we source and match our data</IntentLink>.
            </p>
            <p>Nutrition values and plans are estimates for general information, not medical advice.</p>
            {/* Washington's My Health My Data Act wants the health data policy linked from the homepage. This footer is on every page. */}
            <nav aria-label="Legal">
                <ul className={styles.legal}>
                    <li><IntentLink href={LEGAL_PATHS.privacy}>Privacy Policy</IntentLink></li>
                    <li><IntentLink href={LEGAL_PATHS.healthData}>Consumer Health Data Privacy Policy</IntentLink></li>
                    <li><IntentLink href={LEGAL_PATHS.terms}>Terms of Use</IntentLink></li>
                    {LEGAL_DRAFT && <li className={styles.draft}>Drafts, under legal review</li>}
                </ul>
            </nav>
        </footer>
    );
}
