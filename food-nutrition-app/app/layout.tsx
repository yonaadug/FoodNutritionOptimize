import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import SiteHeader, { SkipLink } from '@/components/shell/SiteHeader';
import SiteFooter from '@/components/shell/SiteFooter';
import Toaster from '@/components/ui/Toaster';
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/nav';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: `${SITE_NAME}: look up the nutrients in any food`,
        template: `%s | ${SITE_NAME}`,
    },
    applicationName: SITE_NAME,
    description: SITE_TAGLINE,
    openGraph: {
        type: 'website',
        siteName: SITE_NAME,
        title: SITE_NAME,
        description: SITE_TAGLINE,
        url: '/',
    },
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
        { media: '(prefers-color-scheme: dark)', color: '#0b1120' },
    ],
};

// Apply the saved theme (or the OS preference) before first paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','light')}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeScript }} />
            </head>
            <body className={inter.className}>
                <SkipLink />
                <SiteHeader />
                {/* Pages render their own <main>; this is the skip link's target. */}
                <div id="main" tabIndex={-1} className="site-main">{children}</div>
                <SiteFooter />
                <Toaster />
            </body>
        </html>
    );
}
