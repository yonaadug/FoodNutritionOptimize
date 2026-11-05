import Link from 'next/link';
import type { Food } from '@/lib/food-types';
import { datasetInfo, fmt, foodPath, resultNutrients } from '@/lib/food-page';
import { typicalServing } from '@/lib/servings';
import { hasCoreData, nv, splitFoodName } from '@/components/planner/nutrients';
import Icon from '@/components/ui/Icon';

export function DatasetBadge({ dataType }: { dataType: string | null | undefined }) {
    const info = datasetInfo(dataType);
    return <span className="source-badge" data-tone={info.tone} title={info.name}>{info.badge}</span>;
}

interface FoodResultRowProps {
    food: Food;
    /** Highlighted amount (best-sources lists), e.g. "14 mcg". */
    highlight?: { value: string; sub?: string };
    /** Called when the row is opened (client parents only). */
    onOpen?: () => void;
}

/**
 * One food in a list: name, category, data source, then calories and a few key
 * nutrients per realistic serving. The whole row is a link. No hooks, so it
 * renders on the server (category and nutrient pages) and in the live search.
 */
export default function FoodResultRow({ food, highlight, onOpen }: FoodResultRowProps) {
    const { name, detail } = splitFoodName(food.description);
    const serving = typicalServing(food.serving_sizes, food);
    const ok = hasCoreData(food);
    const kcal = nv(food, 'calories');
    return (
        <li className="result-item">
            <Link href={foodPath(food)} className="result-link" onClick={onOpen}>
                <div className="result-main">
                    <div className="result-name" title={food.description}>
                        <span className="food-name">{name}</span>
                        {detail && <span className="food-detail">, {detail}</span>}
                    </div>
                    <div className="food-meta">
                        {food.food_category && <span className="chip">{food.food_category}</span>}
                        <DatasetBadge dataType={food.data_type} />
                    </div>
                    {ok ? (
                        <p className="result-nutrients tabular">
                            {resultNutrients(food, serving.grams).map(n => (
                                <span key={n.key}><b>{fmt(n.amount)} {n.unit}</b> {n.label}</span>
                            ))}
                        </p>
                    ) : (
                        <p className="result-nutrients">
                            <span className="chip chip-warn"><Icon name="alert" size={12} /> Limited data</span>
                        </p>
                    )}
                </div>
                {highlight ? (
                    <div className="result-stat tabular">
                        <span className="result-stat-value">{highlight.value}</span>
                        {highlight.sub && <span className="result-stat-sub">{highlight.sub}</span>}
                    </div>
                ) : ok && (
                    <div className="result-stat tabular">
                        <span className="result-stat-value">{kcal === null ? '—' : fmt(kcal * serving.grams / 100, 0)} <small>kcal</small></span>
                        <span className="result-stat-sub">per {serving.label}</span>
                    </div>
                )}
            </Link>
        </li>
    );
}
