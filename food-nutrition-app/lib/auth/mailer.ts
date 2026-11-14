import type { AuthConfig } from './config';

/**
 * Delivers the sign-in email. On a laptop the link is printed to the server console,
 * so no email provider is needed; in production it goes through SES. config.ts
 * refuses the console transport on anything but localhost, because a sign-in link in
 * shared logs is a credential.
 */

export interface SignInMail {
    to: string;
    url: string;
    expiresInMinutes: number;
}

export type Mailer = (mail: SignInMail) => Promise<void>;

function renderText({ url, expiresInMinutes }: SignInMail): string {
    return [
        'Sign in to NutritionDictionary',
        '',
        `Open this link to sign in. It works once and expires in ${expiresInMinutes} minutes:`,
        url,
        '',
        "If you didn't ask for this, you can ignore this email. Nothing happens unless the link is used.",
    ].join('\n');
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderHtml({ url, expiresInMinutes }: SignInMail): string {
    const href = escapeHtml(url);
    return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;line-height:1.5">
<h1 style="font-size:20px">Sign in to NutritionDictionary</h1>
<p><a href="${href}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Continue to sign in</a></p>
<p style="color:#475569">This link works once and expires in ${expiresInMinutes} minutes.</p>
<p style="color:#475569">If you didn't ask for this, you can ignore this email. Nothing happens unless the link is used.</p>
</body></html>`;
}

function consoleMailer(): Mailer {
    return async mail => {
        // The address is left out on purpose: dev logs get pasted into bug reports.
        console.log(`\n[auth] Sign-in link (printed instead of emailed; AUTH_EMAIL_TRANSPORT=console):\n[auth] ${mail.url}\n`);
    };
}

function sesMailer(config: AuthConfig): Mailer {
    return async mail => {
        const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
        const client = new SESv2Client(config.sesRegion ? { region: config.sesRegion } : {});
        await client.send(new SendEmailCommand({
            FromEmailAddress: config.emailFrom,
            Destination: { ToAddresses: [mail.to] },
            Content: {
                Simple: {
                    Subject: { Data: 'Your NutritionDictionary sign-in link', Charset: 'UTF-8' },
                    Body: {
                        Text: { Data: renderText(mail), Charset: 'UTF-8' },
                        Html: { Data: renderHtml(mail), Charset: 'UTF-8' },
                    },
                },
            },
        }));
    };
}

export function createMailer(config: AuthConfig): Mailer {
    return config.emailTransport === 'ses' ? sesMailer(config) : consoleMailer();
}
