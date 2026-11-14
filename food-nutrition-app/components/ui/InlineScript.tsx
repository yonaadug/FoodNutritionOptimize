/**
 * A script that runs while the server's HTML is parsed, before the first paint, so a page
 * can adjust itself to what this browser has saved without a visible jump. It runs only
 * on a full page load: rendered in the browser (a client-side visit) it is inert, which is
 * fine because the component has the real state by then.
 * The pattern is from Next.js's "Preventing flash before hydration" guide.
 */
export default function InlineScript({ html }: { html: string }) {
    return (
        <script
            type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
