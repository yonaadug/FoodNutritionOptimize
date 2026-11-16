import IntentLink from '@/components/ui/IntentLink';
import {
    CONTACT_EMAIL, formatLegalDate, LEGAL_DRAFT, LEGAL_EFFECTIVE_DATE, LEGAL_PATHS, POLICY_TITLES, POLICY_VERSIONS, type PolicyKey,
} from '@/lib/legal';
import DraftNote from './DraftNote';
import styles from './legal.module.css';

/**
 * The frame every legal page shares: title, effective date and version, the draft note
 * while LEGAL_DRAFT is on, a table of contents, and links to the other two documents.
 * Everything variable comes from lib/legal.ts.
 */

export interface Section {
    id: string;
    title: string;
}

/** A placeholder from lib/legal.ts, marked so it stands out while it's unfilled. */
export function Placeholder({ children }: { children: string }) {
    return children.startsWith('[') ? <span className={styles.placeholder}>{children}</span> : <>{children}</>;
}

/** A note for the reviewing lawyer. Hidden once LEGAL_DRAFT is off. */
export function LawyerNote({ title = 'For the lawyer', children }: { title?: string; children: React.ReactNode }) {
    if (!LEGAL_DRAFT) return null;
    return (
        <aside className={styles.lawyer} aria-label={title}>
            <p>{title} (shown only in the draft)</p>
            {children}
        </aside>
    );
}

export function Summary({ children }: { children: React.ReactNode }) {
    return <div className={styles.summary}>{children}</div>;
}

export function Mail() {
    return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

export default function LegalPage({ policy, sections, intro, children }: {
    policy: PolicyKey;
    sections: Section[];
    intro?: React.ReactNode;
    children: React.ReactNode;
}) {
    const others = (Object.keys(LEGAL_PATHS) as PolicyKey[]).filter(k => k !== policy);
    return (
        <main className="container food-page">
            <nav aria-label="Breadcrumb" className="breadcrumb">
                <ol>
                    <li><IntentLink href="/">Foods</IntentLink></li>
                    <li aria-current="page">{POLICY_TITLES[policy]}</li>
                </ol>
            </nav>
            <article className={`panel prose ${styles.page}`} aria-labelledby="legal-title">
                <h1 id="legal-title" className="section-title">{POLICY_TITLES[policy]}</h1>
                <p className={styles.meta}>
                    Effective {formatLegalDate(LEGAL_EFFECTIVE_DATE)} · Version <span data-testid="legal-version">{POLICY_VERSIONS[policy]}</span>
                </p>
                <DraftNote />
                {intro}
                <nav className={styles.toc} aria-label="On this page">
                    <strong>On this page</strong>
                    <ol>
                        {sections.map(s => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}
                    </ol>
                </nav>
                {children}
                <p className={styles.related}>
                    See also: {others.map((k, i) => (
                        <span key={k}>{i > 0 && ' · '}<IntentLink href={LEGAL_PATHS[k]}>{POLICY_TITLES[k]}</IntentLink></span>
                    ))}. Questions: <Mail />.
                </p>
            </article>
        </main>
    );
}
