import { getMe, hasSessionCookie, patchMe } from '@/lib/auth/handlers';
import { jsonOk } from '@/lib/auth/http';
import { accountRoute } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const signedIn = accountRoute('me', getMe);

/**
 * GET /api/me
 * 200: { user: { id, email, displayName, preferences, createdAt } | null }
 * With no session cookie this answers without touching the database or the auth
 * config, so accounts can be down or unconfigured and anonymous visitors never notice.
 */
export async function GET(request: Request) {
    if (!hasSessionCookie(request)) return jsonOk({ user: null });
    return signedIn(request);
}

/** PATCH /api/me { displayName?, preferences? } 200: { user } */
export const PATCH = accountRoute('me', patchMe);
