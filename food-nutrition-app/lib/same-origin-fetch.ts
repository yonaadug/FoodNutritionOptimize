/**
 * Same-origin fetch for browser code. Behind CloudFront, the site's Lambda origin only
 * accepts a request body that arrives with its SHA-256 in `x-amz-content-sha256`: that
 * is what CloudFront's origin access control signs (docs/aws/AWS_HOSTING_DESIGN.md
 * section 3.2). Locally the header is ignored. Anything that sends a body must go
 * through here; lib/same-origin-fetch.test.ts fails the build when browser code doesn't.
 */

type Hashable = string | ArrayBuffer | ArrayBufferView;

/** Lowercase hex SHA-256, the form CloudFront expects. */
export async function sha256Hex(data: Hashable): Promise<string> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export interface SameOriginInit {
    method?: string;
    /** Sent as JSON. */
    json?: unknown;
    /** Sent as is, e.g. a photo. Give its `contentType`. */
    body?: Blob | ArrayBuffer;
    contentType?: string;
    signal?: AbortSignal;
    keepalive?: boolean;
}

export async function sameOriginFetch(path: string, init: SameOriginInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    let body: string | ArrayBuffer | undefined;
    if (init.json !== undefined) {
        body = JSON.stringify(init.json);
        headers['Content-Type'] = 'application/json';
    } else if (init.body !== undefined) {
        // Read the bytes once, so the hash is of exactly what is sent.
        body = init.body instanceof Blob ? await init.body.arrayBuffer() : init.body;
        if (init.contentType) headers['Content-Type'] = init.contentType;
    }
    // Plain-http pages other than localhost have no crypto.subtle; they aren't behind CloudFront.
    if (method !== 'GET' && method !== 'HEAD' && globalThis.crypto?.subtle) {
        headers['x-amz-content-sha256'] = await sha256Hex(body ?? '');
    }
    return fetch(path, { method, headers, body, credentials: 'same-origin', signal: init.signal, keepalive: init.keepalive });
}
