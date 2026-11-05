/** JSON responses for the /api/recipes routes, in the app's { error, code, details? } shape. */
import { NextResponse } from 'next/server';
import { handleError } from '../api';
import { AiError } from '../ai/types';
import { ImageError } from '../ai/image';
import { RequestError } from './request';

export function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}, details?: unknown) {
    return NextResponse.json(details === undefined ? { error: message, code } : { error: message, code, details }, {
        status,
        headers: { 'Cache-Control': 'no-store', ...headers },
    });
}

export function handleRecipeError(err: unknown, context: string) {
    if (err instanceof RequestError) return errorResponse(err.status, err.code, err.message, {}, err.details);
    if (err instanceof AiError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof ImageError) {
        return errorResponse(err.status, err.status === 415 ? 'unsupported_media_type' : 'payload_too_large', err.message);
    }
    return handleError(err, context);
}
