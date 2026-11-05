import { SqliteTable } from '@/lib/user-store/sqlite-table';
import type { SingleTable } from '@/lib/user-store/table';
import { startDynalite } from '@/lib/user-store/testing/dynalite';
import { UserStore } from '@/lib/user-store/user-store';
import { createAuth } from '../auth';
import { loadAuthConfig, type AuthConfig } from '../config';
import { authEndpoint, type AccountDeps } from '../handlers';
import type { SignInMail } from '../mailer';

export const SITE = 'http://localhost:3604';

export interface Harness extends AccountDeps {
    sent: SignInMail[];
    close(): Promise<void>;
}

/** The whole account stack on a given backend, with a mailer that just records. */
export function harnessOn(table: SingleTable, overrides: Partial<NodeJS.ProcessEnv> = {}): Omit<Harness, 'close'> {
    const config: AuthConfig = loadAuthConfig({
        NODE_ENV: 'test',
        AUTH_BASE_URL: SITE,
        AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
        ...overrides,
    } as NodeJS.ProcessEnv);
    const sent: SignInMail[] = [];
    return {
        config,
        table,
        store: new UserStore(table),
        sent,
        auth: createAuth({ table, config, mailer: async mail => { sent.push(mail); } }),
    };
}

export const backends: { name: string; start: () => Promise<{ table: SingleTable; close: () => Promise<void> }> }[] = [
    {
        name: 'SQLite',
        start: async () => {
            const table = new SqliteTable(':memory:');
            return { table, close: async () => table.close() };
        },
    },
    {
        name: 'DynamoDB (dynalite)',
        start: async () => {
            const harness = await startDynalite();
            return { table: harness.table, close: () => harness.close() };
        },
    },
];

let requests = 0;

/**
 * A same-site request, as the browser would send it. Each one has its own address, so
 * per-IP limits only come into play in the tests that pass x-forwarded-for themselves.
 */
export function siteRequest(path: string, init: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
    const method = init.method ?? 'GET';
    requests++;
    const headers: Record<string, string> = { 'x-forwarded-for': `10.${requests >> 16 & 255}.${requests >> 8 & 255}.${requests & 255}`, ...init.headers };
    if (method !== 'GET') headers.origin ??= SITE;
    if (init.cookie) headers.cookie = init.cookie;
    let body: string | undefined;
    if (init.body !== undefined) {
        headers['content-type'] ??= 'application/json';
        body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    }
    return new Request(`${SITE}${path}`, { method, headers, body });
}

/** `name=value` pairs from a response's Set-Cookie headers, dropping cleared ones. */
export function cookiesFrom(res: Response): string {
    return res.headers.getSetCookie()
        .map(c => c.split(';')[0])
        .filter(c => !c.endsWith('='))
        .join('; ');
}

export async function requestLink(deps: Pick<AccountDeps, 'auth' | 'config' | 'store' | 'table'>, email: string, headers?: Record<string, string>) {
    return authEndpoint(siteRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        body: { email, callbackURL: '/account', errorCallbackURL: '/account/sign-in' },
        headers,
    }), deps as AccountDeps);
}

/** The verify URL behind the emailed link (the confirm page's form submits to this). */
export function verifyPath(mail: SignInMail): string {
    const url = new URL(mail.url);
    return `/api/auth/magic-link/verify?${url.searchParams.toString()}`;
}

/** Request a link, follow it, return the session cookie. */
export async function signIn(deps: Harness | Omit<Harness, 'close'>, email: string): Promise<string> {
    await requestLink(deps, email);
    const mail = deps.sent[deps.sent.length - 1];
    const res = await authEndpoint(siteRequest(verifyPath(mail)), deps as AccountDeps);
    const cookie = cookiesFrom(res);
    if (!cookie) throw new Error(`sign-in produced no cookie (status ${res.status}, location ${res.headers.get('location')})`);
    return cookie;
}
