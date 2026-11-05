/**
 * History items: "things this person looked at", stored as a small generic document.
 * The validation here is the only gate between request bodies and the store, so it
 * is strict: everything is length-capped, and `href` can only ever be a path on
 * this site (it is rendered as a link on the account page).
 */

export const HISTORY_LIMITS = {
    kindLength: 32,
    itemIdLength: 128,
    titleLength: 200,
    hrefLength: 512,
    /** Serialized size of `data`, in UTF-8 bytes. */
    dataBytes: 8 * 1024,
    /** Whole POST body. */
    bodyBytes: 16 * 1024,
    /** Oldest items of a kind are evicted beyond this. */
    itemsPerKind: 500,
    pageSizeDefault: 20,
    pageSizeMax: 100,
} as const;

/** The kinds the UI has tabs for. Other validated kinds are stored and exported too. */
export const KNOWN_HISTORY_KINDS = ['food', 'recipe', 'plan'] as const;

export interface HistoryInput {
    kind: string;
    itemId: string;
    title: string;
    href: string;
    data?: unknown;
}

export interface HistoryItem {
    kind: string;
    itemId: string;
    title: string;
    href: string;
    data: unknown;
    createdAt: string;
    updatedAt: string;
}

export class HistoryValidationError extends Error {
    field: string;
    tooLarge: boolean;
    constructor(field: string, message: string, tooLarge = false) {
        super(message);
        this.name = 'HistoryValidationError';
        this.field = field;
        this.tooLarge = tooLarge;
    }
}

const KIND_RE = /^[a-z][a-z0-9-]*$/;
const ITEM_ID_RE = /^[A-Za-z0-9._:~-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function validateKind(kind: unknown): string {
    if (typeof kind !== 'string' || !kind || kind.length > HISTORY_LIMITS.kindLength || !KIND_RE.test(kind)) {
        throw new HistoryValidationError('kind', `kind must be lowercase letters, digits or hyphens (at most ${HISTORY_LIMITS.kindLength} characters)`);
    }
    return kind;
}

export function validateItemId(itemId: unknown): string {
    if (typeof itemId === 'number' && Number.isSafeInteger(itemId)) itemId = String(itemId);
    if (typeof itemId !== 'string' || !itemId || itemId.length > HISTORY_LIMITS.itemIdLength || !ITEM_ID_RE.test(itemId)) {
        throw new HistoryValidationError('itemId', `itemId must be 1-${HISTORY_LIMITS.itemIdLength} characters from A-Z a-z 0-9 . _ : ~ -`);
    }
    return itemId;
}

/**
 * A path on this site, and nothing else: no scheme, no host, no protocol-relative
 * `//evil.example`, no backslash tricks (`/\evil.example`), no control characters.
 */
export function validateHref(href: unknown): string {
    const bad = () => new HistoryValidationError('href', 'href must be a path on this site, starting with a single /');
    if (typeof href !== 'string' || !href || href.length > HISTORY_LIMITS.hrefLength) throw bad();
    if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\') || CONTROL_RE.test(href)) throw bad();
    let parsed: URL;
    try {
        parsed = new URL(href, 'https://site.invalid');
    } catch {
        throw bad();
    }
    if (parsed.origin !== 'https://site.invalid') throw bad();
    return href;
}

export function validateHistoryInput(body: unknown): HistoryInput {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new HistoryValidationError('body', 'Request body must be a JSON object');
    }
    const b = body as Record<string, unknown>;
    const kind = validateKind(b.kind);
    const itemId = validateItemId(b.itemId);
    if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > HISTORY_LIMITS.titleLength) {
        throw new HistoryValidationError('title', `title must be 1-${HISTORY_LIMITS.titleLength} characters`);
    }
    const title = b.title.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(); // eslint-disable-line no-control-regex
    if (!title) throw new HistoryValidationError('title', `title must be 1-${HISTORY_LIMITS.titleLength} characters`);
    const href = validateHref(b.href);
    let data: unknown = null;
    if (b.data !== undefined && b.data !== null) {
        if (typeof b.data !== 'object') throw new HistoryValidationError('data', 'data must be a JSON object or array');
        const serialized = JSON.stringify(b.data);
        if (Buffer.byteLength(serialized, 'utf8') > HISTORY_LIMITS.dataBytes) {
            throw new HistoryValidationError('data', `data must be at most ${HISTORY_LIMITS.dataBytes} bytes when serialized`, true);
        }
        data = b.data;
    }
    return { kind, itemId, title, href, data };
}
