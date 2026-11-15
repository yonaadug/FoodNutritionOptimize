'use client';

import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import IntentLink from '@/components/ui/IntentLink';
import Icon from '@/components/ui/Icon';
import { KIND_LABELS, KIND_ORDER, filterTypes, type FoodTypeOption } from '@/lib/food-groups';
import { datasetInfo, fmt } from '@/lib/food-page';
import { fetchGroupTypes } from '@/hooks/useFoodSearch';

/** Groups this size and larger get a filter box. */
export const FILTER_MIN = 10;
/** At most this many types are drawn at once; the filter narrows the rest. */
const RENDER_MAX = 120;

/** What choosing a type does: open its page, or add it to (remove it from) a list. */
export type TypePickerMode =
    | { kind: 'link'; href: (t: FoodTypeOption) => string; currentId?: number; onOpen?: () => void }
    | {
        kind: 'toggle';
        isOn: (t: FoodTypeOption) => boolean;
        isDisabled?: (t: FoodTypeOption) => boolean;
        onToggle: (t: FoodTypeOption) => Promise<void> | void;
        /** "your foods", "the comparison" */
        target: string;
        /** The food this page is about (shown, not offered). */
        currentId?: number;
    };

interface TypePickerProps {
    id: string;
    /** The food's name ("Cod"). */
    name: string;
    /** Matched types in all; `types` may hold only the first ones. */
    count: number;
    types: FoodTypeOption[];
    /** Where the rest of a large group's types load from. */
    more?: { query: string; groupKey: string };
    mode: TypePickerMode;
    onClose: () => void;
}

/** "Which cod?", keeping brand capitals ("Which McDONALD'S, Big Mac?"). */
export function whichTitle(name: string): string {
    return `Which ${/[A-Z]/.test(name.slice(1)) ? name : name.toLowerCase()}?`;
}

function kcal(t: FoodTypeOption): string {
    return t.calories === null ? '—' : `${fmt(t.calories, 0)} kcal`;
}

function spokenKcal(t: FoodTypeOption): string {
    return t.calories === null ? 'calories not measured' : `${fmt(t.calories, 0)} kcal per 100 grams`;
}

/**
 * Every type of one food, to choose from: the Most common type first, then raw, cooked,
 * canned / dried / cured and other forms, each with calories per 100 g and its USDA
 * dataset. A filter box appears for 10+ types. Arrow keys move between types, Home and
 * End jump, Enter chooses, Esc clears the filter or closes. Focus starts in the filter
 * (or on the first type); the opener gets it back on close.
 */
export default function TypePicker({ id, name, count, types, more, mode, onClose }: TypePickerProps) {
    const [filter, setFilter] = useState('');
    const [loaded, setLoaded] = useState<FoodTypeOption[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [pending, setPending] = useState<number | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const filterRef = useRef<HTMLInputElement>(null);
    const titleId = useId();
    const statusId = useId();

    const needMore = !!more && types.length < count;
    const moreQuery = more?.query;
    const moreKey = more?.groupKey;
    useEffect(() => {
        if (!needMore || moreQuery === undefined || moreKey === undefined) return;
        const ctrl = new AbortController();
        fetchGroupTypes(moreQuery, moreKey, ctrl.signal)
            .then(all => { if (all.length) setLoaded(all); })
            .catch(() => { if (!ctrl.signal.aborted) setLoadError(true); });
        return () => ctrl.abort();
    }, [needMore, moreQuery, moreKey]);

    const all = loaded ?? types;
    const showFilter = count >= FILTER_MIN;
    const matched = useMemo(() => filterTypes(all, filter), [all, filter]);
    const shown = matched.slice(0, RENDER_MAX);
    const first = shown.find(t => t.mostCommon);
    const rest = shown.filter(t => !t.mostCommon);
    const kinds = KIND_ORDER.filter(k => rest.some(t => t.kind === k));

    // Focus the filter (or the first type) when the picker opens.
    useEffect(() => {
        if (showFilter) filterRef.current?.focus();
        else root.current?.querySelector<HTMLElement>('[data-type-item]')?.focus();
    }, [showFilter]);

    const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[data-type-item]:not(:disabled)') ?? []);

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        const inFilter = document.activeElement === filterRef.current;
        let next: HTMLElement | undefined;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (inFilter && filter) setFilter('');
            else onClose();
            return;
        }
        if (e.key === 'ArrowDown') next = inFilter ? list[0] : at >= 0 ? list[Math.min(at + 1, list.length - 1)] : undefined;
        else if (e.key === 'ArrowUp') {
            if (at === 0 && showFilter) { e.preventDefault(); e.stopPropagation(); filterRef.current?.focus(); return; }
            next = at > 0 ? list[at - 1] : undefined;
        } else if (e.key === 'Home' && at >= 0) next = list[0];
        else if (e.key === 'End' && at >= 0) next = list[list.length - 1];
        if (next) {
            e.preventDefault();
            e.stopPropagation();
            next.focus();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            // Stay inside the picker: the page's own arrow-key handling must not take over.
            e.stopPropagation();
        }
    };

    const toggle = async (t: FoodTypeOption) => {
        if (mode.kind !== 'toggle' || pending !== null) return;
        setPending(t.id);
        setActionError(null);
        try {
            await mode.onToggle(t);
        } catch {
            setActionError(`Couldn't change ${t.label}. Please try again.`);
        } finally {
            setPending(null);
        }
    };

    const item = (t: FoodTypeOption) => {
        const badges = (
            <>
                {t.mostCommon && <span className="chip chip-primary type-badge">Most common</span>}
                {mode.currentId === t.id && <span className="chip type-badge">This page</span>}
            </>
        );
        const body = (
            <>
                <span className="type-item-label">{t.label}{badges}</span>
                <span className="type-item-kcal tabular">{kcal(t)}</span>
                <span className="source-badge type-item-source" data-tone={datasetInfo(t.data_type).tone}>{datasetInfo(t.data_type).badge.replace(/^USDA /, '')}</span>
            </>
        );
        const common = t.mostCommon ? ', most common' : '';
        if (mode.kind === 'link') {
            const current = mode.currentId === t.id;
            return (
                <IntentLink lazy href={mode.href(t)} className="type-item" data-type-item="" onClick={mode.onOpen}
                    aria-current={current ? 'page' : undefined}
                    aria-label={`${name}, ${t.label}, ${spokenKcal(t)}${common}${current ? ', this page' : ''}`}>
                    {body}
                </IntentLink>
            );
        }
        const on = mode.isOn(t);
        const self = mode.currentId === t.id;
        const disabled = self || (!on && !!mode.isDisabled?.(t));
        return (
            <button type="button" className="type-item" data-type-item="" aria-pressed={self ? undefined : on} disabled={disabled}
                aria-busy={pending === t.id || undefined}
                aria-label={self
                    ? `${name}, ${t.label}, ${spokenKcal(t)}${common}, this page`
                    : `${on ? 'Remove' : 'Add'} ${name}, ${t.label}, ${spokenKcal(t)}${common}, ${on ? 'from' : 'to'} ${mode.target}`}
                onClick={() => toggle(t)}>
                {body}
                <span className="type-item-action" aria-hidden="true">
                    {self ? null : pending === t.id ? <span className="spinner" /> : on ? <><Icon name="check" size={13} /> Added</> : <><Icon name="plus" size={13} /> Add</>}
                </span>
            </button>
        );
    };

    const total = loaded?.length ?? count;
    const status = filter.trim()
        ? `${matched.length} of ${total} types match “${filter.trim()}”`
        : `${total} types`;

    return (
        <div id={id} className="type-picker" role="group" aria-labelledby={titleId} ref={root} onKeyDown={onKeyDown}>
            <div className="type-picker-head">
                <div>
                    <p className="type-picker-title" id={titleId}>{whichTitle(name)}</p>
                    <p className="tiny muted">{count} types · calories per 100 g</p>
                </div>
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`Close the ${name} types`} onClick={onClose}>
                    <Icon name="x" size={16} />
                </button>
            </div>
            {showFilter && (
                <input ref={filterRef} type="search" className="input input-sm type-filter" autoComplete="off" spellCheck={false}
                    placeholder={`Filter ${count} types, e.g. ${placeholderHint(all)}`}
                    aria-label={`Filter the ${count} types of ${name}`} aria-describedby={statusId}
                    value={filter} onChange={e => setFilter(e.target.value)} />
            )}
            <p className="sr-only" id={statusId} aria-live="polite">{status}</p>
            {needMore && !loaded && !loadError && <p className="tiny muted type-note"><span className="spinner" /> Loading all {count} types…</p>}
            {loadError && <p className="tiny muted type-note">Showing the first {types.length} of {count} types.</p>}
            {actionError && <p className="small type-note type-error" role="alert">{actionError}</p>}

            <div className="type-scroll">
                {first && (
                    <ul className="type-list" aria-label="Most common">
                        <li>{item(first)}</li>
                    </ul>
                )}
                {kinds.map(k => {
                    const sectionId = `${id}-${k}`;
                    return (
                        <div key={k} className="type-section">
                            {(kinds.length > 1 || first) && <p className="type-section-title" id={sectionId}>{KIND_LABELS[k]}</p>}
                            <ul className="type-list" aria-labelledby={kinds.length > 1 || first ? sectionId : undefined} aria-label={kinds.length > 1 || first ? undefined : KIND_LABELS[k]}>
                                {rest.filter(t => t.kind === k).map(t => <li key={t.id}>{item(t)}</li>)}
                            </ul>
                        </div>
                    );
                })}
                {matched.length === 0 && <p className="small muted type-note">No type of {name.toLowerCase()} matches &ldquo;{filter.trim()}&rdquo;.</p>}
                {matched.length > shown.length && (
                    <p className="tiny muted type-note">Showing {shown.length} of {matched.length}. Type in the filter to narrow the list.</p>
                )}
            </div>
        </div>
    );
}

/** The two varieties most types share, to show what filtering is for ("sockeye, chinook"). */
function placeholderHint(types: FoodTypeOption[]): string {
    const counts = new Map<string, number>();
    for (const t of types) {
        const variety = t.label.split(' · ')[0].replace(/\([^)]*\)/g, '').trim().toLowerCase();
        if (variety && variety.length <= 16 && !['raw', 'cooked', 'plain'].includes(variety)) counts.set(variety, (counts.get(variety) ?? 0) + 1);
    }
    const top = Array.from(counts.entries()).filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([w]) => w);
    return top.length === 2 ? top.join(', ') : 'raw, canned';
}

interface TypesToggleProps {
    name: string;
    count: number;
    open: boolean;
    controls: string;
    /** Types of this food already added (planner, Compare). */
    added?: number;
    onClick: () => void;
}

/** The "9 types" control that opens a row's type picker. */
export const TypesToggle = forwardRef<HTMLButtonElement, TypesToggleProps>(function TypesToggle({ name, count, open, controls, added = 0, onClick }, ref) {
    return (
        <button ref={ref} type="button" className="types-toggle" aria-expanded={open} aria-controls={controls}
            aria-label={`${name}, ${count} types${added ? `, ${added} added` : ''}, choose a type`} onClick={onClick}>
            <span>{count} types</span>
            {added > 0 && <span className="types-added">· {added} added</span>}
            <Icon name="chevronDown" size={14} className="types-chevron" />
        </button>
    );
});
