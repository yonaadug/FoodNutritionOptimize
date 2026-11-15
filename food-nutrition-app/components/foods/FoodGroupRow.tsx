'use client';

import { useId, useRef, useState } from 'react';
import type { Food } from '@/lib/food-types';
import type { FoodGroupResult, FoodTypeOption } from '@/lib/food-groups';
import Icon from '@/components/ui/Icon';
import FoodLink from '@/components/food/FoodLink';
import { MostCommonNote } from '@/components/explore/FoodGroupRow';
import { fetchTypeFood } from '@/hooks/useFoodSearch';
import { dataSourceLabel, fmtNumber, hasCoreData, nv } from '@/components/planner/nutrients';
import FoodRow from './FoodRow';
import TypePicker, { TypesToggle } from './TypePicker';

interface FoodGroupRowProps {
    group: FoodGroupResult;
    query: string;
    isAdded: (id: number) => boolean;
    onToggle: (food: Food) => void;
}

/** The full food for a picked type: the row's own food for the representative, else fetched. */
export function foodForType(group: FoodGroupResult, t: FoodTypeOption): Promise<Food> {
    return t.id === group.food.id ? Promise.resolve(group.food) : fetchTypeFood(t.fdc_id);
}

/**
 * One food in the planner's search. A single-entry food is the usual row. A food with
 * several types shows its most common type with the usual Add button (one click for
 * people who don't mind which), and a "9 types" control that opens a picker where each
 * type has its own Add / Added button.
 */
export default function FoodGroupRow({ group, query, isAdded, onToggle }: FoodGroupRowProps) {
    const [open, setOpen] = useState(false);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const pickerId = useId();
    if (group.count <= 1) return <FoodRow food={group.food} added={isAdded(group.food.id)} onToggle={onToggle} />;

    const food = group.food;
    const ok = hasCoreData(food);
    const added = isAdded(food.id);
    const addedTypes = group.types.filter(t => isAdded(t.id)).length;
    const source = dataSourceLabel(food.data_type);
    const commonLabel = group.types.find(t => t.mostCommon)?.label;
    const close = () => {
        setOpen(false);
        toggleRef.current?.focus();
    };

    return (
        <li className="food-group-item" data-open={open || undefined}>
            <div className="food-row">
                <div className="food-row-main">
                    <div className="food-name-line" title={food.description}>
                        <FoodLink food={food}>
                            <span className="food-name">{group.name}</span>
                            <MostCommonNote group={group} />
                        </FoodLink>
                    </div>
                    <div className="food-meta">
                        {food.food_category && <span className="chip">{food.food_category}</span>}
                        {ok ? (
                            <span className="food-stat">
                                <b>{fmtNumber(nv(food, 'calories'), { decimals: 0 })}</b> kcal · <b>{fmtNumber(nv(food, 'protein_g'))}</b> g protein <span className="muted">per 100 g</span>
                            </span>
                        ) : (
                            <span className="chip chip-warn"><Icon name="alert" size={12} /> Limited data</span>
                        )}
                        {source && <span className="tiny muted">{source}</span>}
                    </div>
                </div>
                <div className="food-row-actions">
                    <TypesToggle ref={toggleRef} name={group.name} count={group.count} open={open} controls={pickerId}
                        added={addedTypes} onClick={() => (open ? close() : setOpen(true))} />
                    <button
                        type="button"
                        className="btn-add"
                        aria-pressed={added}
                        aria-label={`${added ? 'Remove' : 'Add'} ${group.name}, ${commonLabel ?? food.description} (most common type) ${added ? 'from' : 'to'} your foods`}
                        onClick={() => onToggle(food)}
                    >
                        {added ? <><Icon name="check" size={14} /> Added</> : <><Icon name="plus" size={14} /> Add</>}
                    </button>
                </div>
            </div>
            {open && (
                <TypePicker id={pickerId} name={group.name} count={group.count} types={group.types}
                    more={{ query, groupKey: group.key }} onClose={close}
                    mode={{
                        kind: 'toggle', target: 'your foods',
                        isOn: t => isAdded(t.id),
                        onToggle: async t => onToggle(await foodForType(group, t)),
                    }} />
            )}
        </li>
    );
}
