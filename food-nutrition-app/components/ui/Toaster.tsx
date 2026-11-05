'use client';

import Icon from '@/components/ui/Icon';
import { dismissToast, useToasts } from '@/hooks/useToasts';

/** Confirmation toasts, announced to screen readers through a polite live region. */
export default function Toaster() {
    const toasts = useToasts();
    return (
        <div className="toaster" role="status" aria-live="polite" aria-relevant="additions text">
            {toasts.map(t => (
                <div key={t.id} className="toast" data-tone={t.tone}>
                    <span className="toast-icon"><Icon name={t.tone === 'info' ? 'info' : 'check'} size={16} strokeWidth={2.6} /></span>
                    <span className="toast-msg">{t.message}</span>
                    {t.action && (
                        <button type="button" className="btn btn-sm toast-action"
                            onClick={() => { t.action!.onClick(); dismissToast(t.id); }}>
                            {t.action.label}
                        </button>
                    )}
                    <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
                        <Icon name="x" size={14} />
                    </button>
                </div>
            ))}
        </div>
    );
}
