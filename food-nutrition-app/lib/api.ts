import { NextResponse } from 'next/server';
import { DatabaseUnavailableError } from './db';

/**
 * Shared helpers for route handlers.
 * Every error response has the shape { error: string, code: string, details?: unknown }.
 */

export type ApiErrorCode =
    | 'invalid_request'
    | 'invalid_input'
    | 'payload_too_large'
    | 'unsupported_media_type'
    | 'not_found'
    | 'database_unavailable'
    | 'internal_error';

// (No TS parameter properties: Node's type stripping, used by `npm test`, rejects them.)
export class ApiError extends Error {
    status: number;
    code: ApiErrorCode;
    details?: unknown;
    constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export function jsonError(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    return NextResponse.json(details === undefined ? { error: message, code } : { error: message, code, details }, {
        status,
        headers: { 'Cache-Control': 'no-store' },
    });
}

/** Convert anything thrown inside a handler into a consistent JSON error. */
export function handleError(err: unknown, context: string) {
    if (err instanceof ApiError) return jsonError(err.status, err.code, err.message, err.details);
    if (err instanceof DatabaseUnavailableError) {
        console.error(`[${context}] ${err.message}`);
        return jsonError(503, 'database_unavailable', 'Nutrition database is unavailable');
    }
    console.error(`[${context}]`, err);
    return jsonError(500, 'internal_error', 'Internal server error');
}

/**
 * Parse an optional integer query parameter.
 * Missing -> fallback; present but not an integer in [min, max] -> 400.
 */
export function intParam(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
    const raw = params.get(name);
    if (raw === null || raw.trim() === '') return fallback;
    if (!/^-?\d+$/.test(raw.trim())) throw new ApiError(400, 'invalid_request', `${name} must be an integer`);
    const n = Number(raw);
    if (n < min || n > max) throw new ApiError(400, 'invalid_request', `${name} must be between ${min} and ${max}`);
    return n;
}

export function boolParam(params: URLSearchParams, name: string): boolean {
    const raw = params.get(name);
    return raw === '1' || raw === 'true';
}

/** Read and parse a JSON request body, enforcing a byte limit. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
    const type = request.headers.get('content-type') ?? '';
    if (type && !/^application\/(.+\+)?json\b/i.test(type)) {
        throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json');
    }
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new ApiError(413, 'payload_too_large', `Request body must be at most ${maxBytes} bytes`);
    }
    const text = await readTextLimited(request, maxBytes);
    if (text.trim() === '') throw new ApiError(400, 'invalid_request', 'Request body is required');
    try {
        return JSON.parse(text);
    } catch {
        throw new ApiError(400, 'invalid_request', 'Request body is not valid JSON');
    }
}

async function readTextLimited(request: Request, maxBytes: number): Promise<string> {
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new ApiError(413, 'payload_too_large', `Request body must be at most ${maxBytes} bytes`);
        }
        chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        buf.set(c, offset);
        offset += c.byteLength;
    }
    return new TextDecoder().decode(buf);
}
