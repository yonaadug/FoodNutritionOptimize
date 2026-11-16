'use client';

import IntentLink from '@/components/ui/IntentLink';
import { apiFetch } from '@/lib/auth/client';
import { LEGAL_PATHS, MINIMUM_AGE, POLICY_VERSIONS } from '@/lib/legal';
import styles from './consent.module.css';

/**
 * The three boxes a person ticks before they get an account (lib/consent.ts has the
 * flow). The health-data box is separate and specific, and its disclosure says what is
 * collected, why, who processes it and how to withdraw, as Washington's My Health My
 * Data Act asks of a consent request.
 */

export interface ConsentChoices {
    acceptTerms: boolean;
    ageConfirmed: boolean;
    healthDataConsent: boolean;
}

export type ConsentKey = keyof ConsentChoices;

export const NO_CHOICES: ConsentChoices = { acceptTerms: false, ageConfirmed: false, healthDataConsent: false };

const ORDER: ConsentKey[] = ['acceptTerms', 'ageConfirmed', 'healthDataConsent'];

export function missingChoices(c: ConsentChoices): ConsentKey[] {
    return ORDER.filter(k => !c[k]);
}

export const consentInputId = (prefix: string, key: ConsentKey) => `${prefix}-${key}`;

/** Move focus to the first unticked box, so a keyboard or screen-reader user lands on it. */
export function focusFirstMissing(prefix: string, missing: ConsentKey[]) {
    if (missing[0]) document.getElementById(consentInputId(prefix, missing[0]))?.focus();
}

export type ConsentResult = { ok: true } | { ok: false; message: string };

/** Send the ticks to the server: signed out, they wait in a cookie until sign-in finishes; signed in, they're recorded. */
export async function sendConsent(choices: ConsentChoices | 'pending'): Promise<ConsentResult> {
    try {
        const res = await apiFetch('/api/consent', {
            method: 'POST',
            json: choices === 'pending' ? { usePending: true } : { ...choices, versions: POLICY_VERSIONS },
        });
        if (res.ok) return { ok: true };
        const body = (await res.json().catch(() => null)) as { error?: string; details?: { reason?: string } } | null;
        if (body?.details?.reason === 'versions_changed') return { ok: false, message: body.error ?? 'Our policies changed. Reload the page to see the new versions.' };
        if (res.status === 429) return { ok: false, message: 'Too many requests. Please wait a minute and try again.' };
        return { ok: false, message: 'We couldn\'t save your choices just now. Please try again.' };
    } catch {
        return { ok: false, message: 'We couldn\'t reach the server. Check your connection and try again.' };
    }
}

export default function ConsentChecks({ value, onChange, missing, idPrefix, legend, errorId }: {
    value: ConsentChoices;
    onChange: (next: ConsentChoices) => void;
    /** Boxes to mark as needing a tick, after a submit attempt. */
    missing: ConsentKey[];
    idPrefix: string;
    legend: string;
    /** The id of the error message the boxes point to, when there is one. */
    errorId?: string;
}) {
    const set = (key: ConsentKey) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.checked });
    const box = (key: ConsentKey, label: React.ReactNode, describedBy?: string) => {
        const id = consentInputId(idPrefix, key);
        const isMissing = missing.includes(key);
        const describers = [describedBy, isMissing ? errorId : undefined].filter(Boolean).join(' ') || undefined;
        return (
            <label className={`${styles.check} ${isMissing ? styles.missing : ''}`} htmlFor={id}>
                <input
                    id={id}
                    type="checkbox"
                    name={key}
                    checked={value[key]}
                    onChange={set(key)}
                    aria-invalid={isMissing || undefined}
                    aria-describedby={describers}
                    data-testid={`consent-${key}`}
                />
                <span>{label}</span>
            </label>
        );
    };
    const disclosureId = `${idPrefix}-health-disclosure`;
    return (
        <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{legend}</legend>
            {box('acceptTerms', <>I agree to the <IntentLink href={LEGAL_PATHS.terms} target="_blank">Terms of Use</IntentLink> and have read the <IntentLink href={LEGAL_PATHS.privacy} target="_blank">Privacy Policy</IntentLink>.</>)}
            {box('ageConfirmed', <>I am {MINIMUM_AGE} or older.</>)}
            <div>
                {box(
                    'healthDataConsent',
                    <>I consent to NutritionDictionary collecting and using my consumer health data to run my account, as described in the <IntentLink href={LEGAL_PATHS.healthData} target="_blank">Consumer Health Data Privacy Policy</IntentLink>.</>,
                    disclosureId,
                )}
                <div id={disclosureId} className={styles.disclosure}>
                    What this covers:
                    <ul>
                        <li><strong>What:</strong> the foods, recipes and plans you save, and the diet goals in them, which can say something about your health.</li>
                        <li><strong>Why:</strong> only to show you your history on any device and run the features you use.</li>
                        <li><strong>Who:</strong> our hosting provider (Amazon Web Services) processes it for us. We never sell it or use it for ads.</li>
                        <li><strong>Withdraw</strong> at any time by deleting your account.</li>
                    </ul>
                </div>
            </div>
        </fieldset>
    );
}
