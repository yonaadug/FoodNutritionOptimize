'use client';

import { useId } from 'react';
import { formatGrams, fromGrams, parseServingAmount, type MassUnit } from '@/lib/serving-scale';

interface CustomAmountProps {
    text: string;
    unit: MassUnit;
    onChange: (text: string, unit: MassUnit) => void;
    /** Visible label, e.g. "Custom amount". */
    label?: string;
    /** Said after the range message while the amount is out of range, e.g. "Showing 100 g for now." */
    fallbackNote?: string;
    /** For screen readers: which food or setting this amount is for. */
    context?: string;
}

/**
 * A custom amount in grams or ounces (1–5,000 g either way). Ounces show their exact
 * grams, so the scaling is visible. Switching unit converts the amount.
 */
export default function CustomAmount({ text, unit, onChange, label = 'Custom amount', fallbackNote, context }: CustomAmountProps) {
    const id = useId();
    const parsed = parseServingAmount(text, unit);
    const switchUnit = (next: MassUnit) => {
        if (next === unit) return;
        // Keep the same weight where there is one; the conversion is shown to 2 decimals.
        const converted = parsed.ok ? Number(fromGrams(parsed.grams, next).toFixed(2)) : null;
        onChange(converted === null ? text : String(converted), next);
    };
    const errId = `${id}-err`;
    const helpId = `${id}-help`;
    return (
        <div className="field custom-amount">
            <label className="field-label" htmlFor={id}>{label}{context && <span className="sr-only"> for {context}</span>}</label>
            <div className="custom-amount-row">
                <input id={id} className="input" type="number" inputMode="decimal" min={0} step="any"
                    value={text} onChange={e => onChange(e.target.value, unit)}
                    aria-invalid={!parsed.ok} aria-describedby={parsed.ok ? (unit === 'oz' ? helpId : undefined) : errId} />
                <select className="select" value={unit} onChange={e => switchUnit(e.target.value as MassUnit)}
                    aria-label={`Unit${context ? ` for ${context}` : ''}`}>
                    <option value="g">g</option>
                    <option value="oz">oz</option>
                </select>
            </div>
            {parsed.ok
                ? unit === 'oz' && <p className="tiny muted tabular" id={helpId}>= {formatGrams(parsed.grams)} g (1 oz = 28.349523125 g)</p>
                : <p className="tiny" id={errId} style={{ color: 'var(--danger)' }}>{parsed.message}{fallbackNote ? ` ${fallbackNote}` : ''}</p>}
        </div>
    );
}
