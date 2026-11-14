import IntentLink from '@/components/ui/IntentLink';
import type { Food } from '@/lib/food-types';
import { fmt, foodPath, keyNutrients } from '@/lib/food-page';
import { typicalServing } from '@/lib/servings';
import { nv, splitFoodName } from '@/components/planner/nutrients';

/** A compact link to a food: name, calories per realistic serving, what it's richest in. Must sit inside a <li>. */
export default function FoodCard({ food }: { food: Food }) {
    const { name, detail } = splitFoodName(food.description);
    const serving = typicalServing(food.serving_sizes, food);
    const top = keyNutrients(food, serving.grams, 1)[0];
    const kcal = nv(food, 'calories');
    return (
        <IntentLink href={foodPath(food)} className="food-card" title={food.description}>
            <span className="food-card-name">{name}</span>
            <span className="food-card-detail">{detail || ' '}</span>
            <span className="food-card-stat tabular">
                <b>{kcal === null ? '—' : fmt(kcal * serving.grams / 100, 0)}</b> kcal per {serving.label}
            </span>
            {top && <span className="food-card-rich">Rich in {top.label.replace(/ \(.*\)$/, '')}</span>}
        </IntentLink>
    );
}
