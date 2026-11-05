'use client';

import { useId } from 'react';
import Icon from '@/components/ui/Icon';
import type { AnalyzedRecipe } from '@/lib/recipes/types';
import { fmt } from '@/lib/food-page';
import styles from './recipes.module.css';

const MAX_TEXT = 20_000;

const EXAMPLE = `Banana oat pancakes
Serves 2

Ingredients
2 ripe bananas, mashed
2 large eggs
1/2 cup rolled oats
1/2 cup milk
1 tsp ground cinnamon
1 tbsp butter

Instructions
Mash the bananas, stir in everything else, and fry small pancakes in the butter.`;

const ingredientCount = (n: number) => `${n} ${n === 1 ? 'ingredient' : 'ingredients'}`;

interface Props {
    error: string | null;
    /** What's in the paste box. Kept by the page, so a failed or cancelled read doesn't lose it. */
    text: string;
    onTextChange: (text: string) => void;
    recents: AnalyzedRecipe[];
    onText: (text: string) => void;
    onPhoto: (file: File) => void;
    onBlank: () => void;
    onOpenRecent: (recipe: AnalyzedRecipe) => void;
    onRemoveRecent: (id: string) => void;
}

/** Three ways in: paste text, add a photo, or start blank. */
export default function RecipeStart({ error, text, onTextChange: setText, recents, onText, onPhoto, onBlank, onOpenRecent, onRemoveRecent }: Props) {
    const textId = useId();
    const canSubmit = text.trim().length > 0;

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // Allows choosing the same file again after an error.
        if (file) onPhoto(file);
    };

    return (
        <>
            <header className={styles.hero}>
                <h1 className="section-title">What&apos;s in your recipe?</h1>
                <p className={styles.heroText}>
                    Paste a recipe or add a photo, and get calories, vitamins and minerals per serving from USDA data.
                    You check the ingredients; the totals follow.
                </p>
            </header>

            {error && (
                <div className={styles.errorBox} role="alert">
                    <Icon name="alert" size={18} /><div>{error}</div>
                </div>
            )}

            <div className={styles.startGrid}>
                <form
                    className={`panel ${styles.pasteCard}`}
                    onSubmit={e => { e.preventDefault(); if (canSubmit) onText(text); }}
                >
                    <div className={styles.labelRow}>
                        <label className="panel-title" htmlFor={textId}>Paste a recipe</label>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText(EXAMPLE)}>Try an example</button>
                    </div>
                    <textarea
                        id={textId}
                        className={`input ${styles.textarea}`}
                        rows={10}
                        maxLength={MAX_TEXT}
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder={'2 cups flour\n1 tsp baking powder\n2 large eggs\n1 cup milk'}
                    />
                    <button type="submit" className="btn btn-primary btn-lg" disabled={!canSubmit}>
                        Work out the nutrition <Icon name="arrowRight" size={16} />
                    </button>
                </form>

                <div className={styles.startSide}>
                    <section className={`panel ${styles.photoCard}`} aria-labelledby="photo-title">
                        <h2 className="panel-title" id="photo-title">Use a photo</h2>
                        <p className="small muted">Works best on a recipe card or cookbook page. A photo of a finished plate gives only a rough estimate.</p>
                        <div className={styles.photoButtons}>
                            <label className={`btn btn-primary-soft ${styles.fileButton}`}>
                                Take a photo
                                <input className="sr-only" type="file" accept="image/*" capture="environment" onChange={onFile} />
                            </label>
                            <label className={`btn btn-secondary ${styles.fileButton}`}>
                                Upload a photo
                                <input className="sr-only" type="file" accept="image/*" onChange={onFile} />
                            </label>
                        </div>
                        <p className="tiny muted">Your photo goes to our AI provider to be read. We don&apos;t store it.</p>
                    </section>

                    <section className={`panel ${styles.photoCard}`} aria-labelledby="blank-title">
                        <h2 className="panel-title" id="blank-title">Start blank</h2>
                        <p className="small muted">Add ingredients one at a time.</p>
                        <button type="button" className="btn btn-secondary" onClick={onBlank}>
                            <Icon name="plus" size={16} /> Start blank
                        </button>
                    </section>
                </div>
            </div>

            {recents.length > 0 && (
                <section className={styles.recents} aria-labelledby="recents-title">
                    <h2 className="panel-title" id="recents-title">Recent recipes</h2>
                    <p className="tiny muted">Saved in this browser only.</p>
                    <ul className={styles.recentList}>
                        {recents.map(r => (
                            <li key={r.id} className={styles.recentItem}>
                                <button type="button" className={styles.recentOpen} onClick={() => onOpenRecent(r)}>
                                    <span className={styles.recentTitle}>{r.title}</span>
                                    <span className="tiny muted">
                                        {r.perServing.calories === null || r.perServing.calories === undefined
                                            ? ingredientCount(r.ingredients.length)
                                            : `${r.incomplete.includes('calories') ? '≥ ' : ''}${fmt(r.perServing.calories, 0)} kcal per serving · ${ingredientCount(r.ingredients.length)}`}
                                    </span>
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${r.title} from recent recipes`} onClick={() => onRemoveRecent(r.id)}>
                                    <Icon name="x" size={15} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </>
    );
}
