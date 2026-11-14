'use client';

import { useState } from 'react';
import type { Food } from '@/lib/food-types';
import type { WeekDay, WeekEntry } from '@/lib/week-planner/types';
import FoodLink from '@/components/food/FoodLink';
import Icon from '@/components/ui/Icon';
import { displayFoodName, fmtNumber, householdAmount, shortFoodName } from '@/components/planner/nutrients';
import { weekActions } from './weekStore';
import styles from './Week.module.css';

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Props {
    days: WeekDay[];
    foods: Record<string, Food>;
    lockedDays: number[];
    lockedItems: string[];
    busy: boolean;
}

function roleTag(e: WeekEntry): string | null {
    if (e.role === 'leftover') return `Leftovers · ${e.servings ?? 1} ${e.servings === 1 ? 'serving' : 'servings'}`;
    if (e.role === 'cooked') {
        const eat = `${e.servings ?? 0} ${e.servings === 1 ? 'serving' : 'servings'}`;
        return e.cooked ? `Cook ${e.cooked} servings, eat ${eat}` : `Cook and eat ${eat}`;
    }
    if (e.role === 'fixed') return 'Every day';
    return null;
}

function Entry({ day, e, food, locked, dayLocked, busy }: { day: number; e: WeekEntry; food: Food; locked: boolean; dayLocked: boolean; busy: boolean }) {
    const tag = roleTag(e);
    const hh = food.recipe ? null : householdAmount(food, e.grams);
    const name = shortFoodName(food.description);
    return (
        <li className={styles.entry} data-locked={locked || dayLocked} data-testid="week-entry" data-food={food.id}>
            <div className={styles.entryMain}>
                <div className={styles.entryName} title={food.description}>
                    <FoodLink food={food}>{displayFoodName(food.description)}</FoodLink>
                </div>
                <div className={styles.entryAmount}>
                    {fmtNumber(e.grams, { decimals: e.grams < 10 ? 1 : 0 })} g{hh ? ` · ${hh}` : ''}
                </div>
                {tag && <span className={styles.tag}>{tag}</span>}
            </div>
            {!dayLocked && (
                <button type="button" className={styles.lockBtn} aria-pressed={locked} disabled={busy}
                    aria-label={locked ? `Unlock ${name} on ${DAY_NAMES[day]}` : `Keep ${name} on ${DAY_NAMES[day]}`}
                    title={locked ? 'Kept when you re-plan. Click to unlock.' : 'Keep this when you re-plan'}
                    onClick={() => weekActions.toggleItem(day, e.foodId)}>
                    <Icon name="pin" size={14} />
                </button>
            )}
        </li>
    );
}

/** Seven day cards: columns on a wide screen, a grid on a tablet, one at a time with a picker on a phone. */
export default function WeekDays({ days, foods, lockedDays, lockedItems, busy }: Props) {
    const [selected, setSelected] = useState(0);
    return (
        <div>
            <div className={styles.picker} data-testid="day-picker">
                <div className="segmented" role="tablist" aria-label="Day">
                    {days.map(d => (
                        <button key={d.index} type="button" role="tab" aria-selected={selected === d.index} aria-controls={`week-day-${d.index}`}
                            onClick={() => setSelected(d.index)}>
                            {DAY_SHORT[d.index] ?? d.index + 1}
                        </button>
                    ))}
                </div>
            </div>
            <div className={styles.days} data-testid="week-days">
                {days.map(d => {
                    const dayLocked = lockedDays.includes(d.index);
                    const protein = d.nutrients.protein_g ?? 0;
                    return (
                        <section key={d.index} id={`week-day-${d.index}`} className={styles.day} data-selected={selected === d.index}
                            data-locked={dayLocked} aria-label={DAY_NAMES[d.index]} data-testid="week-day">
                            <div className={styles.dayHead}>
                                <div>
                                    <div className={styles.dayName}>{DAY_NAMES[d.index] ?? `Day ${d.index + 1}`}</div>
                                    <div className={styles.dayMeta}>{fmtNumber(d.calories, { decimals: 0 })} kcal · {fmtNumber(protein, { decimals: 0 })} g protein</div>
                                </div>
                                <button type="button" className={styles.lockBtn} aria-pressed={dayLocked} disabled={busy}
                                    aria-label={dayLocked ? `Unlock ${DAY_NAMES[d.index]}` : `Keep ${DAY_NAMES[d.index]} as it is`}
                                    title={dayLocked ? 'This day is kept when you re-plan. Click to unlock.' : 'Keep this whole day when you re-plan'}
                                    onClick={() => weekActions.toggleDay(d.index)} data-testid="lock-day">
                                    <Icon name="pin" size={15} />
                                </button>
                            </div>
                            {dayLocked && <span className="tiny" style={{ color: 'var(--primary)', fontWeight: 600 }}>Kept as it is</span>}
                            <ul className={styles.entries}>
                                {d.entries.map(e => {
                                    const food = foods[String(e.foodId)];
                                    if (!food) return null;
                                    return <Entry key={`${e.foodId}-${e.role}`} day={d.index} e={e} food={food} busy={busy}
                                        locked={lockedItems.includes(`${d.index}:${e.foodId}`)} dayLocked={dayLocked} />;
                                })}
                            </ul>
                            {d.entries.length === 0 && <p className="small muted">Nothing planned.</p>}
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
