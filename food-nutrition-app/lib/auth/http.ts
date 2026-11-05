import { isIP } from 'node:net';
import { HistoryValidationError } from '@/lib/user-store/history';
import { InvalidCursorError } from '@/lib/user-store/table';
import type { AuthConfig } from './config';
import { logError } from './log';

/**
 * HTTP helpers for the account routes. Errors have the same shape as lib/api.ts:
 * { error, code, details? }. This uses the standard Response (not NextResponse) so
 * the handlers can run under `node --test` without a Next server.
 */

export type AccountErrorCode =
    | 'invalid_request'
    | 'payload_too_large'
    | 'unsupported_media_type'
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'rate_limited'
    | 'service_unavailable'
    | 'internal_error';

export class AccountError extends Error {
    status: number;
    code: AccountErrorCode;
    details?: unknown;
    retryAfter?: number;
    constructor(status: number, code: AccountErrorCode, message: string, details?: unknown) {
        super(message);
        this.name = 'AccountError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

/** Account data is personal: nothing may cache it, including the CDN. */
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };

export function jsonOk(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    return Response.json(body, { status: init.status ?? 200, headers: { ...PRIVATE_HEADERS, ...init.headers } });
}

function jsonFail(status: number, code: AccountErrorCode, message: string, details?: unknown, headers?: Record<string, string>) {
    return Response.json(details === undefined ? { error: message, code } : { error: message, code, details }, {
        status,
        headers: { ...PRIVATE_HEADERS, ...headers },
    });
}

export function toErrorResponse(err: unknown, context: string): Response {
    if (err instanceof AccountError) {
        return jsonFail(err.status, err.code, err.message, err.details, err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : undefined);
    }
    if (err instanceof HistoryValidationError) {
        return err.tooLarge
            ? jsonFail(413, 'payload_too_large', err.message, { field: err.field })
            : jsonFail(400, 'invalid_request', err.message, { field: err.field });
    }
    if (err instanceof InvalidCursorError) return jsonFail(400, 'invalid_request', 'cursor is not valid');
    logError(context, err);
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AuthConfigError' || name === 'UserStoreConfigError') {
        return jsonFail(503, 'service_unavailable', 'Accounts are not available right now');
    }
    return jsonFail(500, 'internal_error', 'Internal server error');
}

/** Parse a JSON body, enforcing the content type (a CSRF defence) and a byte limit. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
    const type = request.headers.get('content-type') ?? '';
    if (!/^application\/json\b/i.test(type)) {
        throw new AccountError(415, 'unsupported_media_type', 'Content-Type must be application/json');
    }
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new AccountError(413, 'payload_too_large', `Request body must be at most ${maxBytes} bytes`);
    }
    if (!request.body) throw new AccountError(400, 'invalid_request', 'Request body is required');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new AccountError(413, 'payload_too_large', `Request body must be at most ${maxBytes} bytes`);
        }
        chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text.trim()) throw new AccountError(400, 'invalid_request', 'Request body is required');
    try {
        return JSON.parse(text);
    } catch {
        throw new AccountError(400, 'invalid_request', 'Request body is not valid JSON');
    }
}

/**
 * CSRF defence for every state-changing account route, on top of SameSite=Lax: the
 * request must say it came from this site. Browsers always send Origin on POST and
 * DELETE and scripts can't forge it. The configured origin is the reference because
 * behind CloudFront the Host header is the Lambda URL. A request with neither header
 * isn't from a browser page, so it isn't a CSRF risk, but refusing it is simpler and
 * nothing legitimate needs it.
 */
export function assertSameOrigin(request: Request, config: Pick<AuthConfig, 'origins'>) {
    const origin = request.headers.get('origin');
    if (origin ? config.origins.includes(origin) : request.headers.get('sec-fetch-site') === 'same-origin') return;
    throw new AccountError(403, 'forbidden', 'Cross-site request refused');
}

/** The first 64 bits of an IPv6 address: one home or VM usually controls a whole /64. */
function ipv6Prefix(ip: string): string {
    const [head, tail = ''] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const missing = ip.includes('::') ? 8 - left.length - right.length : 0;
    const groups = [...left, ...Array(Math.max(missing, 0)).fill('0'), ...right];
    return `${groups.slice(0, 4).map(g => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

function parseIpValue(header: string, value: string): string | null {
    let candidate = (header === 'x-forwarded-for' ? value.split(',')[0] : value).trim();
    if (header === 'cloudfront-viewer-address') {
        // "1.2.3.4:443" or "2001:db8::1:443": the port is always last.
        const colon = candidate.lastIndexOf(':');
        if (colon === -1) return null;
        candidate = candidate.slice(0, colon).replace(/^\[|\]$/g, '');
    }
    return isIP(candidate) ? candidate : null;
}

/** The client's address, from the configured trusted headers. Null when unknown. */
export function clientIp(request: Request, config: Pick<AuthConfig, 'ipHeaders'>): string | null {
    for (const header of config.ipHeaders) {
        const value = request.headers.get(header);
        if (!value) continue;
        const ip = parseIpValue(header, value);
        if (ip) return ip;
    }
    return null;
}

/** What to count a rate limit against: the address, or its /64 for IPv6. Null when unknown. */
export function rateLimitIp(request: Request, config: Pick<AuthConfig, 'ipHeaders'>): string | null {
    const ip = clientIp(request, config);
    return ip && isIP(ip) === 6 ? ipv6Prefix(ip) : ip;
}
