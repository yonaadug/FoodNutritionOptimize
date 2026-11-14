import { authEndpoint } from '@/lib/auth/handlers';
import { accountRoute } from '@/lib/auth/server';
import { requireSignInConsent } from '@/lib/consent-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Better Auth's endpoints (sign-in, verify, sign-out), limited to the ones the site uses. */
export const GET = accountRoute('auth', authEndpoint);
/** Starting a sign-in (email link or Google) needs the sign-in form's consent first (lib/consent.ts). */
export const POST = accountRoute('auth', requireSignInConsent(authEndpoint));
