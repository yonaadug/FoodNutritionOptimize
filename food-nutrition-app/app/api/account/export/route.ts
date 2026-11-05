import { getAccountExport } from '@/lib/auth/handlers';
import { accountRoute } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/account/export  200: a JSON download of everything held about the signed-in person. */
export const GET = accountRoute('account-export', getAccountExport);
