'use client';

import { useId, useRef, useState } from 'react';
import type { FoodTypeOption } from '@/lib/food-groups';
import { foodPath } from '@/lib/food-page';
import Icon from '@/components/ui/Icon';
import TypePicker from '@/components/foods/TypePicker';

interface TypeSwitcherProps {
    /** The food on this page. */
    foodId: number;
    /** Its group's name ("Cod"). */
    name: string;
    /** Every type of the food, Most common first (getFoodTypes). */
    types: FoodTypeOption[];
    /** The `?serving=` value that carries the chosen serving along (servingParam), or null. */
    serving: string | null;
}

/**
 * "Type: Atlantic · raw ▾ · 1 of 9 types of cod" at the top of a food page: opens the
 * same picker as search, whose entries link to the other types' pages, keeping the
 * serving chosen here when the other type has it (lib/food-groups.ts servingForType).
 */
export default function TypeSwitcher({ foodId, name, types, serving }: TypeSwitcherProps) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const pickerId = useId();
    const current = types.find(t => t.id === foodId);
    if (!current || types.length < 2) return null;

    const close = () => {
        setOpen(false);
        buttonRef.current?.focus();
    };
    const href = (t: FoodTypeOption) => foodPath(t) + (serving ? `?serving=${encodeURIComponent(serving)}` : '');
    const lowerName = /[A-Z]/.test(name.slice(1)) ? name : name.toLowerCase();

    return (
        <section className="type-switcher" aria-label={`Types of ${name}`} data-open={open || undefined}>
            <div className="type-switcher-row">
                <span className="small secondary">Type</span>
                <button ref={buttonRef} type="button" className="types-toggle type-current" aria-expanded={open} aria-controls={pickerId}
                    aria-label={`Type: ${current.label}. ${name}, ${types.length} types, choose a type`}
                    onClick={() => (open ? close() : setOpen(true))}>
                    <span className="type-current-label">{current.label}</span>
                    {current.mostCommon && <span className="chip chip-primary type-badge">Most common</span>}
                    <Icon name="chevronDown" size={14} className="types-chevron" />
                </button>
                <span className="tiny muted">{types.length} types of {lowerName}</span>
            </div>
            {open && (
                <TypePicker id={pickerId} name={name} count={types.length} types={types} onClose={close}
                    mode={{ kind: 'link', href, currentId: foodId }} />
            )}
        </section>
    );
}
