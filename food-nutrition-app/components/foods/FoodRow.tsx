'use client';

import type { Food } from '@/lib/food-types';
import Icon from '@/components/ui/Icon';
import { dataSourceLabel, fmtNumber, hasCoreData, nv, splitFoodName } from '@/components/planner/nutrients';

interface FoodRowProps {
    food: Food;
    added: boolean;
    onToggle: (food: Food) => void;
    /** Optional highlighted value, e.g. "38 g protein". */
    highlight?: string;
}

/** One compact, scannable search/browse result. Designed for long USDA names and thousands of results. */
export default function FoodRow({ food, added, onToggle, highlight }: FoodRowProps) {
    const { name, detail } = splitFoodName(food.description);
    const ok = hasCoreData(food);
    const kcal = nv(food, 'calories');
    const protein = nv(food, 'protein_g');
    const source = dataSourceLabel(food.data_type);

    return (
        <li className="food-row">
            <div className="food-row-main">
                <div className="food-name-line" title={food.description}>
                    <span className="food-name">{name}</span>
                    {detail && <span className="food-detail">, {detail}</span>}
                </div>
                <div className="food-meta">
                    {food.food_category && <span className="chip">{food.food_category}</span>}
                    {ok ? (
                        <span className="food-stat">
                            <b>{fmtNumber(kcal, { decimals: 0 })}</b> kcal · <b>{fmtNumber(protein)}</b> g protein <span className="muted">per 100 g</span>
                        </span>
                    ) : (
                        <span className="chip chip-warn" title="USDA has little or no nutrient data for this food, so plans may undercount it.">
                            <Icon name="alert" size={12} /> Limited data
                        </span>
                    )}
                    {source && <span className="tiny muted">{source}</span>}
                </div>
            </div>
            {highlight && <span className="highlight-badge">{highlight}</span>}
            <button
                type="button"
                className="btn-add"
                aria-pressed={added}
                aria-label={added ? `Remove ${food.description} from your foods` : `Add ${food.description} to your foods`}
                onClick={() => onToggle(food)}
            >
                {added ? <><Icon name="check" size={14} /> Added</> : <><Icon name="plus" size={14} /> Add</>}
            </button>
        </li>
    );
}

export function FoodRowSkeleton({ count = 5 }: { count?: number }) {
    return (
        <div aria-hidden="true">
            {Array.from({ length: count }, (_, i) => (
                <div className="skeleton-row" key={i}>
                    <div style={{ flex: 1 }}>
                        <div className="skeleton" style={{ height: 14, width: `${60 + ((i * 17) % 30)}%` }} />
                        <div className="skeleton" style={{ height: 10, width: '40%', marginTop: 8 }} />
                    </div>
                    <div className="skeleton" style={{ height: 32, width: 76, borderRadius: 999 }} />
                </div>
            ))}
        </div>
    );
}
