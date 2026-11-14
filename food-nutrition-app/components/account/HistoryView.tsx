'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { apiFetch, clearCurrentUser } from '@/lib/auth/client';
import { signInPath } from '@/lib/auth/next-path';
import { historySummary, isSafeHref } from '@/lib/auth/history-summary';
import type { HistoryItem } from '@/lib/user-store/history';
import styles from './account.module.css';

const TABS = [
    { kind: 'food', label: 'Foods', empty: 'Foods you look at will show up here.', browse: '/', browseLabel: 'Look up a food' },
    { kind: 'recipe', label: 'Recipes', empty: 'Recipes you analyze will show up here, with their nutrition.', browse: '/recipes', browseLabel: 'Analyze a recipe' },
    { kind: 'plan', label: 'Plans', empty: 'Plans you make while signed in will show up here, and you can reopen them on any device.', browse: '/plan', browseLabel: 'Make a plan' },
] as const;

type Kind = (typeof TABS)[number]['kind'];

interface TabData {
    items: HistoryItem[];
    nextCursor: string | null;
    /** Free accounts: older plans and recipes kept back (lib/billing/history-limits.ts). */
    limited?: { limit: number; hidden: number };
    status: 'loading' | 'ready' | 'error';
    loadingMore: boolean;
}

const INITIAL: TabData = { items: [], nextCursor: null, status: 'loading', loadingMore: false };
const PAGE_SIZE = 20;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Foods, Recipes and Plans tabs over /api/history. Each tab loads the first time it is opened. */
export default function HistoryView() {
    const [active, setActive] = useState<Kind>('food');
    const [tabs, setTabs] = useState<Partial<Record<Kind, TabData>>>({});
    const [message, setMessage] = useState('');
    const [confirmingClear, setConfirmingClear] = useState(false);
    const tabRefs = useRef<Partial<Record<Kind, HTMLButtonElement | null>>>({});

    const fetchPage = useCallback(async (kind: Kind, cursor?: string) => {
        const params = new URLSearchParams({ kind, limit: String(PAGE_SIZE) });
        if (cursor) params.set('cursor', cursor);
        const res = await apiFetch(`/api/history?${params}`);
        if (res.status === 401) {
            // Signed out in another tab or expired: this page isn't theirs to see any more.
            clearCurrentUser();
            window.location.replace(signInPath(window.location.pathname));
        }
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { items: HistoryItem[]; nextCursor: string | null; limited?: { limit: number; hidden: number } };
    }, []);

    const load = useCallback(async (kind: Kind) => {
        setTabs(t => ({ ...t, [kind]: INITIAL }));
        try {
            const page = await fetchPage(kind);
            setTabs(t => ({ ...t, [kind]: { ...page, status: 'ready', loadingMore: false } }));
        } catch {
            setTabs(t => ({ ...t, [kind]: { ...INITIAL, status: 'error' } }));
        }
    }, [fetchPage]);

    const loaded = Boolean(tabs[active]);
    useEffect(() => {
        if (!loaded) void load(active); // eslint-disable-line react-hooks/set-state-in-effect -- first fetch of a tab
    }, [active, loaded, load]);

    const data = tabs[active] ?? INITIAL;
    const tab = TABS.find(t => t.kind === active)!;

    const loadMore = async () => {
        if (!data.nextCursor) return;
        setTabs(t => ({ ...t, [active]: { ...data, loadingMore: true } }));
        try {
            const page = await fetchPage(active, data.nextCursor);
            setTabs(t => ({ ...t, [active]: { items: [...data.items, ...page.items], nextCursor: page.nextCursor, status: 'ready', loadingMore: false } }));
        } catch {
            setTabs(t => ({ ...t, [active]: { ...data, loadingMore: false } }));
            setMessage('Couldn\'t load more. Please try again.');
        }
    };

    const remove = async (item: HistoryItem) => {
        const params = new URLSearchParams({ kind: item.kind, itemId: item.itemId });
        try {
            const res = await apiFetch(`/api/history?${params}`, { method: 'DELETE' });
            if (!res.ok && res.status !== 404) throw new Error(String(res.status));
            setTabs(t => ({ ...t, [active]: { ...data, items: data.items.filter(i => i.itemId !== item.itemId) } }));
            setMessage(`Removed ${item.title}.`);
        } catch {
            setMessage(`Couldn't remove ${item.title}. Please try again.`);
        }
    };

    const clear = async () => {
        setConfirmingClear(false);
        try {
            const res = await apiFetch(`/api/history?all=1&kind=${active}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(String(res.status));
            setTabs(t => ({ ...t, [active]: { ...INITIAL, status: 'ready' } }));
            setMessage(`${tab.label} history cleared.`);
        } catch {
            setMessage('Couldn\'t clear your history. Please try again.');
        }
    };

    const onTabKey = (e: React.KeyboardEvent) => {
        const at = TABS.findIndex(t => t.kind === active);
        const moves: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 };
        if (!(e.key in moves)) return;
        e.preventDefault();
        const next = TABS[(moves[e.key] + TABS.length) % TABS.length].kind;
        selectTab(next);
        tabRefs.current[next]?.focus();
    };

    const selectTab = (kind: Kind) => {
        setActive(kind);
        setConfirmingClear(false);
        setMessage('');
    };

    return (
        <section className="panel" aria-labelledby="history-title">
            <div className={styles.historyHead}>
                <h2 id="history-title" className={styles.sectionTitle}>History</h2>
                <span className="spacer" />
                <div role="tablist" aria-label="History type" className={styles.tabs} onKeyDown={onTabKey}>
                    {TABS.map(t => (
                        <button
                            key={t.kind}
                            ref={el => { tabRefs.current[t.kind] = el; }}
                            type="button"
                            role="tab"
                            id={`history-tab-${t.kind}`}
                            aria-selected={active === t.kind}
                            aria-controls="history-panel"
                            tabIndex={active === t.kind ? 0 : -1}
                            className={styles.tab}
                            onClick={() => selectTab(t.kind)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div id="history-panel" role="tabpanel" aria-labelledby={`history-tab-${active}`}>
                {data.status === 'loading' && (
                    <div aria-busy="true" aria-label="Loading history">
                        {[0, 1, 2].map(i => (
                            <div className="skeleton-row" key={i}>
                                <div style={{ flex: 1 }}>
                                    <div className="skeleton" style={{ height: 14, width: '55%' }} />
                                    <div className="skeleton" style={{ height: 12, width: '30%', marginTop: 8 }} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {data.status === 'error' && (
                    <div className="empty-state">
                        <p>Couldn&apos;t load your history.</p>
                        <button type="button" className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => load(active)}>Try again</button>
                    </div>
                )}

                {data.status === 'ready' && data.items.length === 0 && (
                    <div className="empty-state">
                        <p>{tab.empty}</p>
                        <Link href={tab.browse} className="btn btn-secondary" style={{ marginTop: 12 }}>{tab.browseLabel}</Link>
                    </div>
                )}

                {data.status === 'ready' && data.items.length > 0 && (
                    <>
                        <ul className={styles.list}>
                            {data.items.map(item => <HistoryRow key={item.itemId} item={item} onRemove={() => remove(item)} />)}
                        </ul>
                        {data.limited && data.limited.hidden > 0 && (
                            <p className={styles.note} data-testid="history-limited">
                                Showing your newest {data.limited.limit} {tab.label.toLowerCase()}. {data.limited.hidden} older {data.limited.hidden === 1 ? 'one is' : 'ones are'} kept
                                in your account and come back with <Link href="/plus">Plus</Link>. Your data export includes them all.
                            </p>
                        )}
                        {data.nextCursor && (
                            <div className={styles.more}>
                                <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={data.loadingMore}>
                                    {data.loadingMore ? 'Loading…' : 'Show more'}
                                </button>
                            </div>
                        )}
                        <div className={styles.more}>
                            {confirmingClear
                                ? (
                                    <span className="row-wrap">
                                        <span className="small">Clear all {tab.label.toLowerCase()}?</span>
                                        <button type="button" className="btn btn-danger-ghost btn-sm" onClick={clear}>Yes, clear</button>
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingClear(false)}>Cancel</button>
                                    </span>
                                )
                                : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingClear(true)}>Clear {tab.label.toLowerCase()}</button>}
                        </div>
                    </>
                )}
            </div>
            <p className="sr-only" role="status">{message}</p>
        </section>
    );
}

function HistoryRow({ item, onRemove }: { item: HistoryItem; onRemove: () => void }) {
    const facts = historySummary(item.data);
    return (
        <li className={styles.row}>
            <div className={styles.rowMain}>
                {isSafeHref(item.href)
                    ? <Link href={item.href} className={styles.rowTitle}>{item.title}</Link>
                    : <span className={styles.rowTitle}>{item.title}</span>}
                <p className={styles.rowDate}>{shortDate(item.updatedAt)}</p>
                {facts.length > 0 && (
                    <ul className={styles.facts}>
                        {facts.map(f => (
                            <li key={f.label} className={styles.fact}><span className={styles.factLabel}>{f.label}</span> {f.value}</li>
                        ))}
                    </ul>
                )}
            </div>
            <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${item.title} from history`} title="Remove" onClick={onRemove}>
                <Icon name="x" size={16} />
            </button>
        </li>
    );
}
