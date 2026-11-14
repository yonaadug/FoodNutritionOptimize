import Icon from '@/components/ui/Icon';
import { LEGAL_DRAFT } from '@/lib/legal';
import styles from './legal.module.css';

/**
 * The visible "Draft, under legal review" note. Rendered only while LEGAL_DRAFT is true
 * (lib/legal.ts). No hooks, so server and client components can both use it.
 */
export default function DraftNote({ compact = false }: { compact?: boolean }) {
    if (!LEGAL_DRAFT) return null;
    return (
        <div className={styles.draft} role="note" data-testid="legal-draft-note">
            <Icon name="alert" />
            <div>
                <p><strong>Draft, under legal review.</strong>{' '}
                    {compact
                        ? 'Our Terms and policies are drafts that a lawyer has not yet approved. They are not legal advice.'
                        : 'This page is a draft written for a lawyer to review. It is not legal advice, it has not been approved, and it may change before launch.'}
                </p>
                {!compact && <p>Text in [SQUARE BRACKETS] is a placeholder the owner has not filled in yet.</p>}
            </div>
        </div>
    );
}
