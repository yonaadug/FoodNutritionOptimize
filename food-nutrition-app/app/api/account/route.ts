import { deleteAccount } from '@/lib/auth/handlers';
import { accountRoute } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/account { confirmEmail }  200: { deleted: true }. Permanent. */
export const DELETE = accountRoute('account-delete', deleteAccount);
