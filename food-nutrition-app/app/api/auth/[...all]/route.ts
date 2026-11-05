import { authEndpoint } from '@/lib/auth/handlers';
import { accountRoute } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Better Auth's endpoints (sign-in, verify, sign-out), limited to the ones the site uses. */
export const GET = accountRoute('auth', authEndpoint);
export const POST = accountRoute('auth', authEndpoint);
