'use client';

import { useState } from 'react';

interface NumberInputProps {
    value: number | undefined;
    onChange: (value: number | undefined) => void;
    label: string;
    /** Visually hide the label (still read by screen readers). */
    hideLabel?: boolean;
    unit?: string;
    placeholder?: string;
    min?: number;
    step?: number | 'any';
    className?: string;
    id?: string;
}

/**
 * A labelled number input that keeps the user's in-progress text (e.g. "1."
 * or "") and reports `undefined` when empty. Every input in the app has a
 * programmatic label.
 */
export default function NumberInput({ value, onChange, label, hideLabel, unit, placeholder, min = 0, step = 'any', className, id }: NumberInputProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const shown = draft ?? (value === undefined ? '' : String(value));

    return (
        <label className="input-unit">
            <span className={hideLabel ? 'sr-only' : 'field-label'}>{label}</span>
            <input
                id={id}
                className={`input input-sm ${className ?? ''}`}
                type="number"
                inputMode="decimal"
                min={min}
                step={step}
                placeholder={placeholder}
                value={shown}
                onChange={e => {
                    const raw = e.target.value;
                    setDraft(raw);
                    if (raw.trim() === '') { onChange(undefined); return; }
                    const n = parseFloat(raw);
                    if (Number.isFinite(n) && n >= min) onChange(n);
                }}
                onBlur={() => setDraft(null)}
            />
            {unit && <span className="unit" aria-hidden="true">{unit}</span>}
        </label>
    );
}
