'use client';

import type { ServingOption } from '@/lib/food-page';

export const CUSTOM_SERVING = 'custom';

interface ServingSelectProps {
    id: string;
    value: string;
    options: readonly ServingOption[];
    onChange: (value: string) => void;
    /** Extra entries before the food's own (e.g. the shared Compare weight when the food has no option at it). */
    leading?: readonly { value: string; label: string }[];
    'aria-describedby'?: string;
}

/**
 * A food's serving menu: USDA household measures, then 1 oz, 3 oz and 100 g, then
 * "Custom amount…". The same menu on the food page and in Compare.
 */
export default function ServingSelect({ id, value, options, onChange, leading = [], ...rest }: ServingSelectProps) {
    const household = options.filter(o => o.group === 'household');
    const weights = options.filter(o => o.group === 'weight');
    return (
        <select id={id} className="select" value={value} onChange={e => onChange(e.target.value)} aria-describedby={rest['aria-describedby']}>
            {leading.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            {household.length > 0 && (
                <optgroup label="Household measures">
                    {household.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </optgroup>
            )}
            <optgroup label="By weight">
                {weights.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                <option value={CUSTOM_SERVING}>Custom amount (g or oz)…</option>
            </optgroup>
        </select>
    );
}
