import { createStripeProvider } from '@/lib/billing/stripe-client';
import { getTable } from '@/lib/user-store';
import { UserStore } from '@/lib/user-store/user-store';
import { createAuth } from './auth';
import { loadAuthConfig } from './config';
import type { AccountDeps } from './handlers';
import { toErrorResponse } from './http';
import { logError } from './log';
import { createMailer } from './mailer';

/**
 * The real dependencies, created on the first account request and kept for the life
 * of the process. Anonymous pages never get here, so a misconfigured store or missing
 * secret can only affect accounts, never the rest of the site.
 */

const globals = globalThis as unknown as { __mdAccountDeps?: Promise<AccountDeps> };

async function createDeps(): Promise<AccountDeps> {
    const config = loadAuthConfig();
    const table = await getTable();
    const stripe = createStripeProvider();
    // Say once why billing is off, unless it simply isn't set up.
    if (!stripe.config.ok && stripe.config.reason !== 'not_configured') logError('billing-config', new Error(stripe.config.ownerMessage));
    return {
        config,
        table,
        store: new UserStore(table),
        auth: createAuth({ table, config, mailer: createMailer(config) }),
        stripe,
    };
}

export function getAccountDeps(): Promise<AccountDeps> {
    if (!globals.__mdAccountDeps) {
        globals.__mdAccountDeps = createDeps().catch(e => {
            globals.__mdAccountDeps = undefined;
            throw e;
        });
    }
    return globals.__mdAccountDeps;
}

/** Adapts an account handler to a Next route handler with consistent JSON errors. */
export function accountRoute(context: string, handler: (request: Request, deps: AccountDeps) => Promise<Response>) {
    return async (request: Request): Promise<Response> => {
        try {
            return await handler(request, await getAccountDeps());
        } catch (err) {
            return toErrorResponse(err, context);
        }
    };
}
