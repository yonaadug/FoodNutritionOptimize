'use client';

import { useId, useState } from 'react';
import type { Food } from '@/lib/db';
import NutritionLabel from './NutritionLabel';
import Icon from '@/components/ui/Icon';
import { splitFoodName } from '@/components/planner/nutrients';

interface ComparisonViewProps {
    foods: Food[];
    onClose: () => void;
}

/** Side-by-side Nutrition Facts labels with a per-food serving-size picker. */
export default function ComparisonView({ foods, onClose }: ComparisonViewProps) {
    const titleId = useId();
    return (
        <section className="panel fade-in" aria-labelledby={titleId} id="compare">
            <div className="panel-header">
                <div style={{ flex: 1 }}>
                    <h2 className="panel-title" id={titleId}>Compare nutrition labels</h2>
                    <p className="panel-sub">Scroll sideways to see every food. Pick a serving size to scale a label.</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={15} /> Close</button>
            </div>
            {foods.length === 0 ? (
                <p className="muted">Add some foods to compare them here.</p>
            ) : (
                <div className="label-scroller" role="list">
                    {foods.map(f => <LabelCard key={f.id} food={f} />)}
                </div>
            )}
        </section>
    );
}

function LabelCard({ food }: { food: Food }) {
    const servings = (food.serving_sizes ?? []).filter(s => s.weight_g > 0 && !/^100\s?g$/i.test(s.label.trim()));
    const [servingId, setServingId] = useState<string>('100');
    const selectId = useId();
    const chosen = servings.find(s => String(s.id) === servingId);
    const grams = chosen ? chosen.weight_g : 100;
    const label = chosen ? `${chosen.label} (${Math.round(chosen.weight_g)} g)` : '100 g';
    const { name, detail } = splitFoodName(food.description);

    return (
        <div role="listitem" className="stack" style={{ gap: 10 }}>
            <div>
                <h3 style={{ fontSize: 15, fontWeight: 700 }} title={food.description}>{name}</h3>
                {detail && <p className="small secondary food-name-line">{detail}</p>}
                {food.food_category && <span className="chip" style={{ marginTop: 6 }}>{food.food_category}</span>}
            </div>
            <div className="field">
                <label className="field-label" htmlFor={selectId}>Serving size</label>
                <select id={selectId} className="select" value={servingId} onChange={e => setServingId(e.target.value)}>
                    <option value="100">100 g</option>
                    {servings.map(s => <option key={s.id} value={String(s.id)}>{s.label} ({Math.round(s.weight_g)} g)</option>)}
                </select>
            </div>
            <NutritionLabel food={food} grams={grams} servingLabel={label} />
        </div>
    );
}
