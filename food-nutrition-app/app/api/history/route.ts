import { deleteHistory, getHistory, postHistory } from '@/lib/auth/handlers';
import { accountRoute } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/history?kind=food&limit=20&cursor=...  200: { items, nextCursor } (newest first) */
export const GET = accountRoute('history', getHistory);

/** POST /api/history { kind, itemId, title, href, data? }  200: { item } (upsert) */
export const POST = accountRoute('history', postHistory);

/** DELETE /api/history?kind=food&itemId=1, or ?all=1[&kind=food]  200: { removed } */
export const DELETE = accountRoute('history', deleteHistory);
