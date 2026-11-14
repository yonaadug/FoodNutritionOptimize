import IntentLink from '@/components/ui/IntentLink';
import type { Food } from '@/lib/food-types';
import { foodHref } from '@/lib/food-page';
import { OLDER_ENTRY_NOTE } from '@/lib/nutrient-fill';

/**
 * A food's name as a link to its page (a recipe's links to the recipe), where its
 * nutrients and contaminants are. Plain text if there's nowhere to go.
 */
export default function FoodLink({ food, className, children }: {
    food: Pick<Food, 'fdc_id' | 'description' | 'recipe'>;
    className?: string;
    children: React.ReactNode;
}) {
    const href = foodHref(food);
    if (!href) return <span className={className}>{children}</span>;
    // Lists can hold many foods: only fetch a page once someone points at it or focuses it.
    return <IntentLink href={href} lazy className={`food-link${className ? ` ${className}` : ''}`}>{children}</IntentLink>;
}

/** The mark beside a value that isn't from the food's own USDA record. */
export function OlderEntryMark() {
    return (
        <sup className="older-mark" title={`Value ${OLDER_ENTRY_NOTE}`}>
            <span aria-hidden="true">†</span>
            <span className="sr-only"> ({OLDER_ENTRY_NOTE})</span>
        </sup>
    );
}
