'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Icon from '@/components/ui/Icon';
import { notify } from '@/hooks/useToasts';
import {
    blankEditor, clampServings, editorFromParse, editorFromRecord, loadRecents, RECENTS_KEY, removeRecent, rowsNutrition,
    saveRecent, setRowAmount, setRowFood, toRecord, type EditorState,
} from '@/lib/recipes/editor';
import type { AnalyzedIngredient, AnalyzedRecipe, ParseResponse, RecipeFood, RecipeNutrition } from '@/lib/recipes/types';
import { fetchFood, matchLine, parseImage, parseText } from './api';
import { downscaleForUpload } from './downscale';
import IngredientTable from './IngredientTable';
import RecipeStart from './RecipeStart';
import RecipeTotals from './RecipeTotals';
import styles from './recipes.module.css';

function browserStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function newId(): string {
    // randomUUID needs a secure context; plain http on a LAN doesn't have one.
    return globalThis.crypto?.randomUUID?.() ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const recentsListeners = new Set<() => void>();
const subscribeRecents = (cb: () => void) => { recentsListeners.add(cb); return () => { recentsListeners.delete(cb); }; };
const recentsSnapshot = () => { try { return browserStorage()?.getItem(RECENTS_KEY) ?? null; } catch { return null; } };
const emitRecents = () => recentsListeners.forEach(l => l());

/** How long edits must settle before the record is saved and reported. */
const SAVE_DEBOUNCE_MS = 800;

type Phase = 'start' | 'reading' | 'editing';

export default function RecipeAnalyzer({ onRecipeAnalyzed }: { onRecipeAnalyzed?: (recipe: AnalyzedRecipe) => void }) {
    const [phase, setPhase] = useState<Phase>('start');
    const [readingPhoto, setReadingPhoto] = useState(false);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const abort = useRef<AbortController | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const lastSaved = useRef<string>('');
    const pendingSave = useRef<{ editor: EditorState; nutrition: RecipeNutrition } | null>(null);

    const rawRecents = useSyncExternalStore(subscribeRecents, recentsSnapshot, () => null);
    const recents = useMemo(() => (rawRecents ? loadRecents(browserStorage()) : []), [rawRecents]);

    const nutrition = useMemo(() => (editor ? rowsNutrition(editor.rows, editor.servings) : null), [editor]);

    // Move focus to the editor when it appears, so keyboard and screen reader users land on the result.
    useEffect(() => {
        if (phase === 'editing') heading.current?.focus();
    }, [phase]);

    useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

    // Save and report once edits settle. The record has a stable id, so this is an upsert.
    const flushSave = useCallback(() => {
        const current = pendingSave.current;
        if (!current) return;
        pendingSave.current = null;
        const record = toRecord(current.editor, current.nutrition, new Date().toISOString());
        const key = JSON.stringify({ ...record, updatedAt: '' });
        if (key === lastSaved.current) return;
        lastSaved.current = key;
        saveRecent(browserStorage(), record);
        emitRecents();
        onRecipeAnalyzed?.(record);
    }, [onRecipeAnalyzed]);

    useEffect(() => {
        if (phase !== 'editing' || !editor || !nutrition || editor.rows.length === 0) return;
        pendingSave.current = { editor, nutrition };
        const timer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [phase, editor, nutrition, flushSave]);

    // Don't lose the last edits to a quick navigation or a closed tab.
    useEffect(() => {
        window.addEventListener('pagehide', flushSave);
        return () => {
            window.removeEventListener('pagehide', flushSave);
            flushSave();
        };
    }, [flushSave]);

    const read = useCallback(async (run: (signal: AbortSignal) => Promise<ParseResponse>, isPhoto: boolean) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setError(null);
        setReadingPhoto(isPhoto);
        setPhase('reading');
        try {
            const parsed = await run(controller.signal);
            setEditor(editorFromParse(parsed, newId(), new Date().toISOString()));
            setPhase('editing');
        } catch (e) {
            if ((e as Error).name === 'AbortError') return;
            setError((e as Error).message);
            setPhase('start');
        }
    }, []);

    const onText = useCallback((text: string) => {
        setPhotoUrl(null);
        void read(signal => parseText(text, signal), false);
    }, [read]);

    const onPhoto = useCallback((file: File) => {
        setPhotoUrl(URL.createObjectURL(file));
        void read(async signal => parseImage(await downscaleForUpload(file), signal), true);
    }, [read]);

    const onBlank = useCallback(() => {
        setError(null);
        setPhotoUrl(null);
        setEditor(blankEditor(newId(), new Date().toISOString()));
        setPhase('editing');
    }, []);

    const cancelReading = useCallback(() => {
        abort.current?.abort();
        setPhotoUrl(null);
        setPhase('start');
    }, []);

    const startOver = useCallback(() => {
        flushSave();
        lastSaved.current = '';
        setEditor(null);
        setPhotoUrl(null);
        setError(null);
        setPhase('start');
    }, [flushSave]);

    const onOpenRecent = useCallback(async (record: AnalyzedRecipe) => {
        setError(null);
        setReadingPhoto(false);
        setPhotoUrl(null);
        setPhase('reading');
        try {
            const ids = Array.from(new Set(record.ingredients.map(i => i.fdcId).filter((id): id is number => id !== null)));
            const results = await Promise.allSettled(ids.map(id => fetchFood(id)));
            const foods = new Map<number, RecipeFood>();
            results.forEach(r => { if (r.status === 'fulfilled') foods.set(r.value.fdc_id, r.value); });
            setEditor(editorFromRecord(record, foods));
            setPhase('editing');
        } catch (e) {
            setError((e as Error).message);
            setPhase('start');
        }
    }, []);

    const onRemoveRecent = useCallback((id: string) => {
        removeRecent(browserStorage(), id);
        emitRecents();
    }, []);

    const patch = useCallback((fn: (s: EditorState) => EditorState) => setEditor(s => (s ? fn(s) : s)), []);
    const patchRow = useCallback((id: string, fn: (r: AnalyzedIngredient) => AnalyzedIngredient) => {
        patch(s => ({ ...s, rows: s.rows.map(r => (r.id === id ? fn(r) : r)) }));
    }, [patch]);

    const onAmount = useCallback((id: string, quantity: number | null, unit: string | null) => {
        patchRow(id, r => setRowAmount(r, quantity, unit));
    }, [patchRow]);
    const onFood = useCallback((id: string, food: RecipeFood) => {
        patchRow(id, r => setRowFood(r, food));
    }, [patchRow]);
    const onRemove = useCallback((row: AnalyzedIngredient, index: number) => {
        patch(s => ({ ...s, rows: s.rows.filter(r => r.id !== row.id) }));
        notify(`Removed ${row.name}.`, {
            tone: 'info',
            action: {
                label: 'Undo',
                onClick: () => patch(s => {
                    const rows = [...s.rows];
                    rows.splice(Math.min(index, rows.length), 0, row);
                    return { ...s, rows };
                }),
            },
        });
    }, [patch]);
    const onAdd = useCallback(async (line: string) => {
        const ingredient = await matchLine(line);
        patch(s => ({ ...s, rows: [...s.rows, ingredient] }));
        return ingredient;
    }, [patch]);

    if (phase === 'start' || !editor && phase !== 'reading') {
        return (
            <main className={`container ${styles.page}`}>
                <RecipeStart
                    error={error}
                    recents={recents}
                    onText={onText}
                    onPhoto={onPhoto}
                    onBlank={onBlank}
                    onOpenRecent={r => void onOpenRecent(r)}
                    onRemoveRecent={onRemoveRecent}
                />
            </main>
        );
    }

    if (phase === 'reading') {
        return (
            <main className={`container ${styles.page}`}>
                <div className={`panel ${styles.reading}`} role="status">
                    {readingPhoto && photoUrl && (
                        // A local object URL for a preview: next/image doesn't apply.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={styles.readingPhoto} src={photoUrl} alt="Your photo" />
                    )}
                    <span className="spinner" aria-hidden="true" />
                    <p className={styles.readingText}>Reading your recipe…</p>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={cancelReading}>Cancel</button>
                </div>
            </main>
        );
    }

    return (
        <main className={`container ${styles.page}`}>
            <div className={styles.editorHead}>
                <div className={styles.titleBlock}>
                    <h1 className="section-title" ref={heading} tabIndex={-1}>Check your recipe</h1>
                    <p className="small muted">Fix anything we misread. The totals update as you go.</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={startOver}>
                    <Icon name="arrowLeft" size={15} /> New recipe
                </button>
            </div>

            <Notices state={editor!} photoUrl={photoUrl} />

            <div className={styles.editorGrid}>
                <section className={`panel ${styles.editorMain}`} aria-label="Recipe details and ingredients">
                    <div className={styles.metaRow}>
                        <div className={`field ${styles.titleField}`}>
                            <label className="field-label" htmlFor="recipe-title">Recipe name</label>
                            <input
                                id="recipe-title" className="input" value={editor!.title} maxLength={120}
                                onChange={e => { const title = e.target.value; patch(s => ({ ...s, title })); }}
                            />
                        </div>
                        <ServingsField servings={editor!.servings} onChange={servings => patch(s => ({ ...s, servings }))} />
                    </div>
                    <IngredientTable
                        rows={editor!.rows}
                        onAmount={onAmount}
                        onFood={onFood}
                        onRemove={onRemove}
                        onAdd={onAdd}
                    />
                </section>
                <RecipeTotals state={editor!} nutrition={nutrition!} />
            </div>
        </main>
    );
}

/** Keeps what the person is typing ("1.", "") and only reports valid servings. */
function ServingsField({ servings, onChange }: { servings: number; onChange: (n: number) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    const parsed = draft === null ? servings : clampServings(Number(draft));
    return (
        <div className={`field ${styles.servingsField}`}>
            <label className="field-label" htmlFor="recipe-servings">Servings</label>
            <input
                id="recipe-servings" className="input" type="number" inputMode="decimal" min={0.5} max={200} step="any"
                value={draft ?? String(servings)}
                aria-invalid={parsed === null}
                aria-describedby={parsed === null ? 'recipe-servings-error' : undefined}
                onChange={e => {
                    setDraft(e.target.value);
                    const n = clampServings(Number(e.target.value));
                    if (n !== null) onChange(n);
                }}
                onBlur={() => setDraft(null)}
            />
            {parsed === null && <span id="recipe-servings-error" className={styles.fieldError}>Enter a number above 0.</span>}
        </div>
    );
}

function Notices({ state, photoUrl }: { state: EditorState; photoUrl: string | null }) {
    const isPhoto = state.source === 'image';
    return (
        <div className={styles.notices}>
            {isPhoto && state.platedMeal && (
                <div className={styles.noticeWarn} role="note">
                    <Icon name="alert" size={18} />
                    <div>
                        <strong>This is a rough estimate from a photo.</strong>{' '}
                        A photo can show what&apos;s on the plate, but not how much, and it can&apos;t show oil or butter used in cooking.
                        In published tests, AI calorie estimates from meal photos were typically off by about 20–40%, and vitamins and minerals can be further off.
                        Check each amount below, and weigh the food if accuracy matters to you.
                    </div>
                </div>
            )}
            {isPhoto && !state.platedMeal && (
                <div className={styles.noticeInfo} role="note">
                    <Icon name="info" size={18} />
                    <div>Read from your photo. Compare the amounts with your recipe, especially if it&apos;s handwritten.</div>
                </div>
            )}
            {state.provider === 'mock' && (
                <div className={styles.noticeInfo} role="note">
                    <Icon name="info" size={18} />
                    <div>
                        <strong>Demo mode.</strong> No AI is connected, so pasted text uses our built-in reader
                        {isPhoto ? ', and this photo result is a built-in sample, not a reading of your photo.' : '.'}
                    </div>
                </div>
            )}
            {state.warnings.filter(w => !(state.provider === 'mock' && /^Demo mode/.test(w))).map(w => (
                <div key={w} className={styles.noticeInfo} role="note">
                    <Icon name="info" size={18} /><div>{w}</div>
                </div>
            ))}
            {photoUrl && (
                <details className={styles.photoDetails}>
                    <summary>Show my photo</summary>
                    {/* A local object URL that never leaves this page: next/image doesn't apply. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className={styles.photo} src={photoUrl} alt="The photo you added" />
                </details>
            )}
        </div>
    );
}
