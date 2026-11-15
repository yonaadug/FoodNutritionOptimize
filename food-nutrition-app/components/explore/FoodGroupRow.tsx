'use client';

import { useId, useRef, useState } from 'react';
import IntentLink from '@/components/ui/IntentLink';
import type { FoodGroupResult } from '@/lib/food-groups';
import { foodPath } from '@/lib/food-page';
import TypePicker, { TypesToggle } from '@/components/foods/TypePicker';
import FoodResultRow, { ResultBody } from './FoodResultRow';

/** The "most common: Atlantic · wild caught · raw" line under a group's name. */
export function MostCommonNote({ group }: { group: FoodGroupResult }) {
    const label = group.types.find(t => t.mostCommon)?.label;
    return label ? <span className="food-detail"> · most common: {label}</span> : null;
}

/**
 * One food in the home search. A food USDA lists once is the same row as always. A food
 * with several types ("Cod · 9 types") is one row: the row opens the most common type's
 * page, and the "9 types" control opens a picker to open another type's page instead.
 */
export default function FoodGroupRow({ group, query, onOpen }: { group: FoodGroupResult; query: string; onOpen?: () => void }) {
    const [open, setOpen] = useState(false);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const pickerId = useId();
    if (group.count <= 1) return <FoodResultRow food={group.food} onOpen={onOpen} />;

    const close = () => {
        setOpen(false);
        toggleRef.current?.focus();
    };

    return (
        <li className="result-item result-group" data-open={open || undefined}>
            <div className="result-group-head">
                <IntentLink href={foodPath(group.food)} className="result-link" onClick={onOpen}>
                    <ResultBody food={group.food} name={<>
                        <span className="food-name">{group.name}</span>
                        <MostCommonNote group={group} />
                    </>} />
                </IntentLink>
                <TypesToggle ref={toggleRef} name={group.name} count={group.count} open={open} controls={pickerId}
                    onClick={() => (open ? close() : setOpen(true))} />
            </div>
            {open && (
                <TypePicker id={pickerId} name={group.name} count={group.count} types={group.types}
                    more={{ query, groupKey: group.key }} onClose={close}
                    mode={{ kind: 'link', href: t => foodPath(t), onOpen }} />
            )}
        </li>
    );
}
