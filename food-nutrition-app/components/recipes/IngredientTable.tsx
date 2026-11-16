'use client';

import { useRef, useState } from 'react';
import IntentLink from '@/components/ui/IntentLink';
import Icon from '@/components/ui/Icon';
import NumberInput from '@/components/ui/NumberInput';
import { shortFoodName } from '@/components/planner/nutrients';
import { foodPath } from '@/lib/food-page';
import { rowFlags } from '@/lib/recipes/editor';
import { UNIT_CHOICES, UNITS, unitLabel } from '@/lib/recipes/units';
import type { AnalyzedIngredient, RecipeFood } from '@/lib/recipes/types';
import FoodChooser from './FoodChooser';
import styles from './recipes.module.css';

interface Props {
    rows: AnalyzedIngredient[];
    onAmount: (id: string, quantity: number | null, unit: string | null) => void;
    onFood: (id: string, food: RecipeFood) => void;
    onRemove: (row: AnalyzedIngredient, index: number) => void;
    onAdd: (line: string) => Promise<AnalyzedIngredient>;
}

function gramsText(g: number | null): string {
    if (g === null) return '—';
    if (g >= 100) return `${Math.round(g)} g`;
    if (g >= 10) return `${Math.round(g * 10) / 10} g`;
    return `${Math.round(g * 100) / 100} g`;
}

/** Editable ingredients. A real table on wide screens; each row stacks into a card on a phone. */
export default function IngredientTable({ rows, onAmount, onFood, onRemove, onAdd }: Props) {
    return (
        <div className={styles.tableBlock}>
            {rows.length > 0 ? (
                <table className={styles.table}>
                    <caption className="sr-only">Ingredients, their amounts and the USDA food each is matched to</caption>
                    <thead>
                        <tr>
                            <th scope="col">Ingredient</th>
                            <th scope="col">Amount</th>
                            <th scope="col">USDA food</th>
                            <th scope="col">Weight</th>
                            <th scope="col"><span className="sr-only">Remove</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <IngredientRow key={row.id} row={row} index={i} onAmount={onAmount} onFood={onFood} onRemove={onRemove} />
                        ))}
                    </tbody>
                </table>
            ) : (
                <p className={`small muted ${styles.emptyRows}`}>No ingredients yet. Add the first one below.</p>
            )}
            <AddIngredient onAdd={onAdd} />
        </div>
    );
}

function IngredientRow({ row, index, onAmount, onFood, onRemove }: {
    row: AnalyzedIngredient;
    index: number;
    onAmount: Props['onAmount'];
    onFood: Props['onFood'];
    onRemove: Props['onRemove'];
}) {
    const [choosing, setChoosing] = useState(false);
    const changeButton = useRef<HTMLButtonElement>(null);
    const flags = rowFlags(row);
    const details = [row.preparation, row.notes].filter(Boolean).join(' · ');
    const unitValue = row.unit ?? '';
    const unitKnown = row.unit === null || UNIT_CHOICES.includes(row.unit);

    return (
        <>
            <tr className={styles.row} data-testid="ingredient-row">
                <td className={styles.cellName} data-label="Ingredient">
                    <span className={styles.name}>{row.name}</span>
                    {details && <span className={`tiny muted ${styles.details}`}>{details}</span>}
                    {flags.checkAmount && <span className="chip chip-warn">Check this</span>}
                </td>
                <td className={styles.cellAmount} data-label="Amount">
                    <div className={styles.amount}>
                        <NumberInput
                            label={`Amount of ${row.name}`}
                            hideLabel
                            className={styles.qty}
                            value={row.quantity ?? undefined}
                            onChange={v => onAmount(row.id, v ?? null, row.unit)}
                        />
                        <label>
                            <span className="sr-only">Unit for {row.name}</span>
                            <select
                                className={`select input-sm ${styles.unit}`}
                                value={unitValue}
                                onChange={e => onAmount(row.id, row.quantity, e.target.value || null)}
                            >
                                <option value="">item</option>
                                {!unitKnown && row.unit && <option value={row.unit}>{UNITS[row.unit]?.unit ?? row.unit}</option>}
                                {UNIT_CHOICES.map(u => <option key={u} value={u}>{unitLabel(u, row.quantity)}</option>)}
                            </select>
                        </label>
                    </div>
                </td>
                <td className={styles.cellFood} data-label="USDA food">
                    {row.food ? (
                        <IntentLink href={foodPath(row.food)} className={styles.foodLink} target="_blank" title={row.food.description}>
                            <span className={styles.foodShort}>{shortFoodName(row.food.description)}</span>
                            <span className={`tiny muted ${styles.foodFull}`}>{row.food.description}</span>
                        </IntentLink>
                    ) : (
                        <span className="chip chip-danger">No match yet</span>
                    )}
                    {flags.checkMatch && <span className="chip chip-warn">Check match</span>}
                    <button
                        ref={changeButton}
                        type="button"
                        className={`btn btn-ghost btn-sm ${styles.changeFood}`}
                        aria-expanded={choosing}
                        aria-label={`${row.food ? 'Change' : 'Choose'} the food for ${row.name}`}
                        onClick={() => setChoosing(c => !c)}
                    >
                        {row.food ? 'Change' : 'Choose a food'}
                    </button>
                </td>
                <td className={styles.cellGrams} data-label="Weight">
                    <span className={styles.grams} data-testid="row-grams">{gramsText(row.conversion.grams)}</span>
                    {flags.estimated && <span className="chip chip-warn" title={row.conversion.basis}>Estimated</span>}
                    {flags.uncounted && <span className="chip chip-danger">Not counted</span>}
                    <span className={`tiny muted ${styles.basis}`}>{row.conversion.basis}</span>
                </td>
                <td className={styles.cellRemove}>
                    <button type="button" className="btn btn-danger-ghost btn-sm" aria-label={`Remove ${row.name}`} onClick={() => onRemove(row, index)}>
                        <Icon name="trash" size={16} />
                    </button>
                </td>
            </tr>
            {choosing && (
                <tr className={styles.chooserRow}>
                    <td colSpan={5}>
                        <FoodChooser
                            row={row}
                            onPick={food => { onFood(row.id, food); setChoosing(false); changeButton.current?.focus(); }}
                            onClose={() => { setChoosing(false); changeButton.current?.focus(); }}
                        />
                    </td>
                </tr>
            )}
        </>
    );
}

function AddIngredient({ onAdd }: { onAdd: Props['onAdd'] }) {
    const [line, setLine] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [added, setAdded] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const value = line.trim();
        if (!value || busy) return;
        setBusy(true);
        setError(null);
        try {
            const ingredient = await onAdd(value);
            setLine('');
            setAdded(`Added ${ingredient.name}.`);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className={styles.addForm} onSubmit={e => void submit(e)}>
            <label className="field-label" htmlFor="add-ingredient">Add an ingredient</label>
            <div className={styles.addRow}>
                <input
                    id="add-ingredient" className="input" value={line} maxLength={300} autoComplete="off"
                    placeholder="e.g. 2 tbsp olive oil"
                    aria-describedby={error ? 'add-ingredient-error' : undefined}
                    aria-invalid={!!error}
                    onChange={e => setLine(e.target.value)}
                />
                <button type="submit" className="btn btn-primary-soft" disabled={!line.trim() || busy}>
                    {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="plus" size={16} />} Add
                </button>
            </div>
            {error && <p id="add-ingredient-error" className={styles.fieldError} role="alert">{error}</p>}
            <span className="sr-only" role="status">{added}</span>
        </form>
    );
}
