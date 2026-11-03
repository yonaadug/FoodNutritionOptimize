import { NextResponse } from 'next/server';
import { getDbInfo, getMeta } from '@/lib/db';
import { handleError } from '@/lib/api';

export const runtime = 'nodejs';
// Reads the database at request time; never prerender at build.
export const dynamic = 'force-dynamic';

/**
 * GET /api/meta
 * 200: { meta: Record<string, string> | null, searchMode: 'fts' | 'like', foodCount }
 * `meta` is the provenance table written by the DB build (null for older DBs).
 */
export async function GET() {
    try {
        return NextResponse.json({ meta: getMeta(), ...getDbInfo() });
    } catch (error) {
        return handleError(error, 'meta');
    }
}
