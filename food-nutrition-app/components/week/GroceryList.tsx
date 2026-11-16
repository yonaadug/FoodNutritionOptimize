'use client';

import IntentLink from '@/components/ui/IntentLink';
import { useId, useMemo } from 'react';
import type { Food } from '@/lib/food-types';
import { groceryCsv, groceryList, groceryText, lineAmount } from '@/lib/week-planner/grocery';
import type { WeekDay } from '@/lib/week-planner/types';
import Icon from '@/components/ui/Icon';
import { notify } from '@/hooks/useToasts';
import { weekActions } from './weekStore';
import styles from './Week.module.css';

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Older or locked-down browsers: select a hidden textarea and copy that.
        try {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            area.remove();
            return ok;
        } catch {
            return false;
        }
    }
}

function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The week's shopping, by aisle, with ticks that stay in this browser. */
export default function GroceryList({ days, foods, checked }: { days: WeekDay[]; foods: Record<string, Food>; checked: number[] }) {
    const headingId = useId();
    const groups = useMemo(() => groceryList(days, foods), [days, foods]);
    const ticked = new Set(checked);
    const total = groups.reduce((s, g) => s + g.lines.length, 0);
    const done = groups.reduce((s, g) => s + g.lines.filter(l => ticked.has(l.foodId)).length, 0);

    return (
        <section className="panel" aria-labelledby={headingId} data-testid="grocery-list">
            <div className="panel-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <h2 className="panel-title" id={headingId}>Grocery list</h2>
                    <p className="panel-sub">
                        The whole week, in weights and the units shops sell. {done > 0 ? `${done} of ${total} ticked.` : `${total} items.`}
                    </p>
                </div>
                <div className={`row-wrap ${styles.printHide}`}>
                    <button type="button" className="btn btn-secondary btn-sm" data-testid="grocery-copy" onClick={async () => {
                        const ok = await copyText(groceryText(groups, ticked));
                        notify(ok ? 'Copied the list.' : "Couldn't copy. Select the list and copy it yourself.", { tone: ok ? 'success' : 'info' });
                    }}>Copy as text</button>
                    <button type="button" className="btn btn-secondary btn-sm" data-testid="grocery-csv"
                        onClick={() => download('grocery-list.csv', groceryCsv(groups, ticked), 'text/csv;charset=utf-8')}>
                        Download CSV
                    </button>
                    {done > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={weekActions.clearChecked}>Clear ticks</button>}
                </div>
            </div>
            <p className={`tiny muted ${styles.printHide}`} style={{ marginBottom: 12 }}>
                To print the week and this list, use your browser&apos;s Print (Ctrl+P, or ⌘P on a Mac). The page prints without the menus and buttons.
            </p>
            <div className={styles.grocery}>
                {groups.map(g => (
                    <div key={g.aisle} className={styles.aisle}>
                        <h3 className={styles.aisleTitle}>{g.aisle}</h3>
                        <ul className={styles.lines}>
                            {g.lines.map(l => (
                                <li key={l.foodId} className={styles.line} data-checked={ticked.has(l.foodId)} data-testid="grocery-line">
                                    <label>
                                        <input type="checkbox" checked={ticked.has(l.foodId)} onChange={() => weekActions.toggleChecked(l.foodId)} />
                                        <span style={{ minWidth: 0 }}>
                                            <span className={styles.lineName}>{l.name}</span>
                                            <span className={styles.lineAmount} style={{ display: 'block' }}>{lineAmount(l)}</span>
                                        </span>
                                    </label>
                                    {l.recipe && (
                                        <p className="tiny" style={{ margin: '0 0 8px 30px' }}>
                                            <IntentLink href={`/recipes?id=${encodeURIComponent(l.recipe.recipeId)}`}>See the recipe&apos;s ingredients</IntentLink>
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
            <p className="tiny muted" style={{ marginTop: 12 }}>
                <Icon name="info" size={12} /> Weights are as USDA lists the food (raw or cooked as named). Counts are rounded up so you buy enough.
            </p>
        </section>
    );
}
