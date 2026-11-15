import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage, { LawyerNote, Mail, Placeholder, Summary, type Section } from '@/components/legal/LegalPage';
import {
    BROWSER_STORAGE, COOKIES, EU_UK_REPRESENTATIVE, LEGAL_PATHS, MINIMUM_AGE, OWNER_LEGAL_NAME, OWNER_POSTAL_ADDRESS, RETENTION,
} from '@/lib/legal';

export const metadata: Metadata = {
    title: 'Privacy Policy',
    description: 'What NutritionDictionary collects, why, who processes it, how long it is kept, and your rights.',
    alternates: { canonical: LEGAL_PATHS.privacy },
};

/** An external link. */
function Ext({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

const SECTIONS: Section[] = [
    { id: 'who', title: 'Who we are' },
    { id: 'collect', title: 'What we collect' },
    { id: 'why', title: 'Why we use it' },
    { id: 'ai', title: 'Recipe photos, text and AI' },
    { id: 'processors', title: 'Who processes it' },
    { id: 'retention', title: 'How long we keep it' },
    { id: 'rights', title: 'Your rights' },
    { id: 'gdpr', title: 'EU and UK (GDPR)' },
    { id: 'california', title: 'California (CCPA/CPRA)' },
    { id: 'us-states', title: 'Other US states' },
    { id: 'cookies', title: 'Cookies and browser storage' },
    { id: 'children', title: 'Children' },
    { id: 'transfers', title: 'International transfers' },
    { id: 'security', title: 'Security' },
    { id: 'changes', title: 'Changes to this policy' },
    { id: 'contact', title: 'Contact' },
];

export default function PrivacyPage() {
    return (
        <LegalPage
            policy="privacy"
            sections={SECTIONS}
            intro={(
                <Summary>
                    <ul>
                        <li>You can use the whole site without an account. Your planner, recent recipes and searches then stay in your browser.</li>
                        <li>With an account we keep your email address and the foods, recipes and plans you choose to keep, so you can see them on any device.</li>
                        <li>We don&apos;t sell your data, show ads, or use analytics or tracking pixels.</li>
                        <li>Recipe photos and some pasted recipes are read by AI on Amazon Bedrock. We don&apos;t save the photos.</li>
                        <li>You can export or delete your account at any time. Deleted data leaves our backups within {RETENTION.backupsDays} days.</li>
                    </ul>
                </Summary>
            )}
        >
            <h2 id="who">Who we are</h2>
            <p>
                NutritionDictionary (nutritiondictionary.com) is run by <Placeholder>{OWNER_LEGAL_NAME}</Placeholder> (&quot;we&quot;, &quot;us&quot;).
                We decide how your personal data is used, which makes us its &quot;controller&quot; under the GDPR.
                Postal address: <Placeholder>{OWNER_POSTAL_ADDRESS}</Placeholder>. Email: <Mail />.
            </p>
            <p>
                Data that could say something about your health, such as your diet goals and saved plans, has its own policy too:
                our <Link href={LEGAL_PATHS.healthData}>Consumer Health Data Privacy Policy</Link>.
            </p>

            <h2 id="collect">What we collect</h2>
            <h3>If you don&apos;t have an account</h3>
            <ul>
                <li>
                    <strong>What you type or upload to use a feature.</strong> Food searches, the foods and goals you send to the planner,
                    and recipe text or photos you ask us to read. Our server uses them to answer that request and doesn&apos;t save them.
                </li>
                <li>
                    <strong>What stays in your browser.</strong> Your planner, last plan, recent recipes and recent searches are kept in your
                    browser&apos;s storage, not on our servers. See <a href="#cookies">Cookies and browser storage</a>.
                </li>
                <li>
                    <strong>Technical data.</strong> Like any website, our hosting receives your IP address and the pages and files your browser
                    asks for. We use it to deliver the site and to stop abuse. Our application logs don&apos;t record IP addresses or email
                    addresses. The recipe reader counts requests per IP address in server memory, for up to {RETENTION.aiRateLimitHours} hours,
                    to stop one visitor using it all up. Amazon CloudFront&apos;s firewall can also limit requests per IP address.
                </li>
            </ul>
            <p>Without an account we set no cookies, unless you start signing in.</p>

            <h3>If you have an account</h3>
            <ul>
                <li><strong>Your email address,</strong> which is how you sign in. There are no passwords.</li>
                <li><strong>A display name,</strong> if you add one.</li>
                <li>
                    <strong>If you sign in with Google:</strong> the name, email address, profile picture link and Google account ID that Google
                    sends us, and the sign-in tokens Google issues. We don&apos;t get your Google password or contacts.
                </li>
                <li>
                    <strong>Your history,</strong> which is recorded only while you&apos;re signed in:
                    <ul>
                        <li>foods you open (the food, its calories per typical serving and what it&apos;s rich in);</li>
                        <li>recipes you analyze (the title, ingredients and nutrition per serving);</li>
                        <li>plans you make (the foods, amounts, limits and nutrition goals, any recipes in them, and a summary).</li>
                    </ul>
                    We keep up to {RETENTION.historyItemsPerKind} of each and remove the oldest after that. What you did before signing in is
                    added only if you press <em>Save to my account</em>.
                </li>
                <li><strong>Your agreements:</strong> which versions of our Terms and policies you agreed to, when, and that you confirmed your age. We don&apos;t record your IP address or device with them.</li>
                <li>
                    <strong>Sign-in records:</strong> a session token and when it expires, and a one-time sign-in link stored only as a hash.
                    Sessions don&apos;t record your IP address or device.
                </li>
                <li>
                    <strong>Abuse counters:</strong> short-lived counts of requests, mostly stored under a scrambled (keyed hash) form of your IP
                    address, email address or account ID. One exception: the sign-in system&apos;s own counters use your IP address as it is, for
                    up to {RETENTION.signInRateLimitMinutes} minutes.
                </li>
            </ul>

            <h3>If you subscribe to Plus</h3>
            <p>
                Payments are handled by Stripe on its own pages. You give your card details to Stripe, not to us, and we never see or store your
                card number. Stripe tells us your customer ID, which plan you have, whether it&apos;s active or in a trial, and when it renews or ends.
                Stripe keeps payment records as financial and tax law requires.
            </p>
            <LawyerNote>
                <ul>
                    <li>Plus is being built in parallel. Check this section against the billing code before launch (which Stripe fields are stored, and whether billing country or email is kept).</li>
                </ul>
            </LawyerNote>

            <h3>What we don&apos;t collect</h3>
            <p>
                We don&apos;t ask for your weight, height, age, sex, pregnancy or medical conditions. We don&apos;t use advertising, analytics or
                social-media trackers, and we don&apos;t collect your precise location. Photos are resized in your browser before upload, and the
                server removes the metadata from JPEG photos (which can include the GPS location) before an AI reads them.
            </p>

            <h2 id="why">Why we use it</h2>
            <ul>
                <li>To run the features you ask for: food lookup, contaminant meters, the planner and the recipe reader.</li>
                <li>To keep your account: signing you in, and showing your foods, recipes and plans on any device.</li>
                <li>To run Plus, if you subscribe: checking your plan and limits, and letting you manage it.</li>
                <li>To send the emails you ask for, such as sign-in links. We don&apos;t send marketing email.</li>
                <li>To keep the site secure and working: rate limits, error logs and preventing abuse.</li>
                <li>To keep a record of what you agreed to, and to meet legal obligations.</li>
            </ul>
            <p>We don&apos;t use your data for advertising, we don&apos;t sell it, and we don&apos;t use it to train AI models.</p>

            <h2 id="ai">Recipe photos, text and AI</h2>
            <p>
                When you upload a recipe photo, or paste a recipe our built-in reader isn&apos;t sure about, we send it to Amazon Bedrock, an AWS
                service, to read the ingredients. The text or photo is processed by AI models running on Amazon Bedrock: currently Google&apos;s
                Gemma 3, operated by AWS, with Amazon Nova as a backup. AWS is our processor for this; Google doesn&apos;t receive your recipe or
                photo from us. AI reads can be wrong, so the page asks you to check every ingredient.
            </p>
            <ul>
                <li>
                    <strong>We don&apos;t save your photo.</strong> It&apos;s held in memory while it&apos;s read and then discarded. Under our
                    retention rules, an uploaded photo is never kept longer than {RETENTION.photosDays} day.
                </li>
                <li>
                    <strong>It isn&apos;t used for training.</strong> The <Ext href="https://aws.amazon.com/bedrock/faqs/">Amazon Bedrock FAQ</Ext> says
                    your content &quot;is not used to improve the base models and is not shared with any model providers&quot;, and that AWS and the
                    third-party model providers &quot;will not use any inputs to or outputs from Amazon Bedrock to train&quot; their models.
                    AWS&apos;s <Ext href="https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html">Bedrock data protection page</Ext> adds
                    that model providers &quot;don&apos;t have access to Amazon Bedrock logs or to customer prompts and completions&quot;.
                </li>
                <li>Bedrock&apos;s model-invocation logging is off, so Bedrock doesn&apos;t keep a copy of the prompt or photo for us.</li>
                <li>Our logs record only the model used, the time taken, the token count and the cost, never the recipe or the photo.</li>
                <li>If you&apos;re signed in, the analyzed recipe (title, ingredients, nutrition) is saved to your history so you can reopen it. The photo isn&apos;t.</li>
            </ul>

            <h2 id="processors">Who processes it</h2>
            <p>These companies process data for us, under their own privacy terms. We don&apos;t share your data with anyone else for their own use.</p>
            <div className="table-scroll" tabIndex={0} role="group" aria-label="Service providers">
                <table>
                    <thead>
                        <tr><th scope="col">Provider</th><th scope="col">What it does for us</th><th scope="col">What it receives</th></tr>
                    </thead>
                    <tbody>
                        <tr>
                            <th scope="row">Amazon Web Services (AWS)</th>
                            <td>Hosting in the US (us-east-1): CloudFront (delivery and firewall), Lambda (the server), DynamoDB (accounts and history), CloudWatch (logs)</td>
                            <td>Everything the site stores or receives</td>
                        </tr>
                        <tr>
                            <th scope="row">AWS: Amazon SES</th>
                            <td>Sends sign-in emails from no-reply@nutritiondictionary.com</td>
                            <td>Your email address and the sign-in link</td>
                        </tr>
                        <tr>
                            <th scope="row">AWS: Amazon Bedrock</th>
                            <td>Reads recipe photos and some pasted recipes with AI models it runs (currently Google&apos;s Gemma 3, with Amazon Nova as a backup)</td>
                            <td>The photo or recipe text, with nothing that identifies you</td>
                        </tr>
                        <tr>
                            <th scope="row">Google</th>
                            <td>Sign-in with Google, only if you choose it</td>
                            <td>That you&apos;re signing in to NutritionDictionary</td>
                        </tr>
                        <tr>
                            <th scope="row">Stripe</th>
                            <td>Plus payments, invoices and the subscription portal, only if you subscribe</td>
                            <td>What you enter on Stripe&apos;s pages, and your account ID and email from us</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p>
                We don&apos;t use Cloudflare or any other third-party script, font service or analytics. The site&apos;s font is served from our own
                hosting. Privacy terms: <Ext href="https://aws.amazon.com/privacy/">AWS</Ext>, <Ext href="https://policies.google.com/privacy">Google</Ext>,{' '}
                <Ext href="https://stripe.com/privacy">Stripe</Ext>.
            </p>
            <p>We may disclose data if the law requires it, for example in response to a valid court order, and we&apos;ll tell you when the law allows.</p>

            <h2 id="retention">How long we keep it</h2>
            <div className="table-scroll" tabIndex={0} role="group" aria-label="How long data is kept">
                <table>
                    <thead><tr><th scope="col">Data</th><th scope="col">Kept for</th></tr></thead>
                    <tbody>
                        <tr><th scope="row">Your account and history</th><td>Until you delete them or your account. You can delete single items too</td></tr>
                        <tr><th scope="row">Your agreements</th><td>As long as your account exists</td></tr>
                        <tr><th scope="row">Sessions</th><td>{RETENTION.sessionDays} days from last use, or until you sign out</td></tr>
                        <tr><th scope="row">Sign-in links</th><td>{RETENTION.signInLinkMinutes} minutes, and they work once</td></tr>
                        <tr><th scope="row">Uploaded photos</th><td>Not saved. Never more than {RETENTION.photosDays} day</td></tr>
                        <tr><th scope="row">Server logs</th><td>{RETENTION.logsDays} days</td></tr>
                        <tr><th scope="row">Abuse counters</th><td>Minutes to hours; the recipe reader&apos;s in-memory counts up to {RETENTION.aiRateLimitHours} hours</td></tr>
                        <tr><th scope="row">Database backups</th><td>{RETENTION.backupsDays} days</td></tr>
                        <tr><th scope="row">Your browser&apos;s storage</th><td>Until you clear it, sign out or delete your account</td></tr>
                    </tbody>
                </table>
            </div>
            <p id="backups">
                <strong>Backups.</strong> Our database keeps continuous backups (DynamoDB point-in-time recovery) for {RETENTION.backupsDays} days, so
                we can recover from mistakes. When you delete your account or an item, it&apos;s removed from the live database straight away,
                but copies stay in those backups until they age out, within {RETENTION.backupsDays} days. We don&apos;t restore deleted data from
                backups except to recover from a failure, and if we ever do, we delete your data again.
            </p>
            <p>
                Short-lived records such as sessions and counters expire automatically. The database removes expired records in the background,
                usually within a few days, and they can&apos;t be used once expired.
            </p>
            <LawyerNote>
                <ul>
                    <li>There is no automatic deletion of inactive accounts. GDPR storage limitation may call for one (for example after 2 years without a sign-in).</li>
                    <li>Consent records are deleted with the account. Decide whether proof of consent should be kept longer.</li>
                </ul>
            </LawyerNote>

            <h2 id="rights">Your rights</h2>
            <p>Wherever you live, you can:</p>
            <ul>
                <li><strong>See and export your data:</strong> on your <Link href="/account">account page</Link>, press <em>Export my data</em> to download everything we hold about you, including your agreements, as a file.</li>
                <li><strong>Delete it:</strong> remove single history items on your <Link href="/account/history">history page</Link>, or press <em>Delete my account</em> on your account page to delete everything. Backups age out within {RETENTION.backupsDays} days, as <a href="#backups">explained above</a>.</li>
                <li><strong>Correct it:</strong> change your display name on your account page. To change your email address, email us.</li>
                <li><strong>Withdraw consent:</strong> deleting your account withdraws it and removes the data. You can also email us.</li>
                <li><strong>Clear this browser:</strong> signing out clears the planner, recipes and searches stored in this browser. Your browser&apos;s settings can clear it too.</li>
            </ul>
            <p>
                Or email <Mail /> from the address on your account. We&apos;ll answer within one month, sooner if your local law requires it, and
                we won&apos;t treat you differently for using your rights. If we can&apos;t do what you ask, we&apos;ll explain why, and you can
                appeal by replying to that email with &quot;Appeal&quot;; we&apos;ll answer the appeal within the time your law allows. You can
                send a request through someone you authorize; we may ask them for proof.
            </p>

            <h2 id="gdpr">EU and UK (GDPR)</h2>
            <p>
                The site is available worldwide, so if you&apos;re in the European Economic Area or the UK, the GDPR or the UK GDPR gives you the
                rights to access, correct, delete, restrict and object to the use of your data, to receive it in a portable format, and to
                withdraw consent at any time without affecting what happened before. Here is the legal basis for each use:
            </p>
            <div className="table-scroll" tabIndex={0} role="group" aria-label="Lawful bases">
                <table>
                    <thead><tr><th scope="col">Use</th><th scope="col">Legal basis</th></tr></thead>
                    <tbody>
                        <tr><th scope="row">Your account: email, name, sign-in method, sessions</th><td>Contract: to provide the account you ask for (Art. 6(1)(b))</td></tr>
                        <tr><th scope="row">History of foods, recipes and plans, and your diet goals</th><td>Explicit consent, which you give at sign-in (Art. 6(1)(a) and Art. 9(2)(a), as it may count as health data)</td></tr>
                        <tr><th scope="row">Reading a recipe or photo you send</th><td>Contract: to provide the feature you ask for (Art. 6(1)(b))</td></tr>
                        <tr><th scope="row">Plus subscription and payments</th><td>Contract (Art. 6(1)(b)); keeping invoices is a legal obligation (Art. 6(1)(c))</td></tr>
                        <tr><th scope="row">Security, rate limits and error logs</th><td>Legitimate interests: keeping the site safe and available (Art. 6(1)(f))</td></tr>
                        <tr><th scope="row">Recording what you agreed to</th><td>Legal obligation to be able to show consent (Art. 7(1)), and legitimate interests</td></tr>
                    </tbody>
                </table>
            </div>
            <p>
                You can complain to your local data protection authority (in the EU, listed by
                the <Ext href="https://www.edpb.europa.eu/about-edpb/about-edpb/members_en">European Data Protection Board</Ext>; in the UK,
                the <Ext href="https://ico.org.uk/make-a-complaint/">ICO</Ext>), though we&apos;d like the chance to help first.
                Our representative in the EU and UK: <Placeholder>{EU_UK_REPRESENTATIVE}</Placeholder>.
            </p>

            <h2 id="california">California (CCPA/CPRA)</h2>
            <p>
                If you live in California, the California Consumer Privacy Act, as amended by the CPRA, gives you the right to know what we
                collect and why, to delete it, to correct it, to opt out of its sale or sharing, to limit the use of sensitive personal
                information, and not to be discriminated against for using these rights. We give these rights to everyone, whether or not the
                law applies to us.
            </p>
            <ul>
                <li><strong>What we collect</strong> (the last 12 months): identifiers (email, name, account ID, IP address); sensitive personal information (diet goals and history that could relate to health); internet activity on our site (the foods, recipes and plans you keep); and, for Plus, commercial information (your plan and its status).</li>
                <li><strong>Sources:</strong> you, your browser, Google if you sign in with it, and Stripe if you subscribe.</li>
                <li><strong>Purposes and disclosures:</strong> as described above. We disclose data only to the service providers listed in <a href="#processors">Who processes it</a>.</li>
                <li><strong>No sale or sharing.</strong> We don&apos;t sell personal information or share it for cross-context behavioral advertising, and we haven&apos;t in the last 12 months. We don&apos;t knowingly sell or share the data of anyone under 16.</li>
                <li><strong>Sensitive personal information</strong> is used only to provide the features you ask for, never to infer things about you.</li>
                <li><strong>Global Privacy Control:</strong> because we don&apos;t sell or share personal information, there&apos;s nothing for a GPC signal to opt you out of.</li>
            </ul>

            <h2 id="us-states">Other US states</h2>
            <p>
                Residents of states with consumer privacy laws, such as Virginia, Colorado, Connecticut, Utah, Texas, Oregon, Montana, Iowa,
                Delaware, New Hampshire, New Jersey, Nebraska, Tennessee, Minnesota, Maryland, Indiana, Kentucky and Rhode Island, have similar
                rights to access, correct, delete and port their data, to opt out of sale, targeted advertising and profiling, and to appeal a
                refusal. We don&apos;t sell data, run targeted advertising or profile people in ways that have legal or similar effects. Use the
                steps in <a href="#rights">Your rights</a>. If we deny your appeal, you can contact your state attorney general.
            </p>
            <p>
                Washington, Nevada and Connecticut have specific rules for health data. Our{' '}
                <Link href={LEGAL_PATHS.healthData}>Consumer Health Data Privacy Policy</Link> covers them.
            </p>

            <h2 id="cookies">Cookies and browser storage</h2>
            <p>
                We use only first-party cookies that are needed for signing in. There are no advertising, analytics or third-party cookies,
                so there&apos;s nothing to opt out of.
            </p>
            <div className="table-scroll" tabIndex={0} role="group" aria-label="Cookies">
                <table>
                    <thead><tr><th scope="col">Cookie</th><th scope="col">Purpose</th><th scope="col">Lasts</th></tr></thead>
                    <tbody>
                        {COOKIES.map(c => <tr key={c.name}><th scope="row"><code>{c.name}</code></th><td>{c.what}</td><td>{c.lasts}</td></tr>)}
                    </tbody>
                </table>
            </div>
            <p>
                The site also keeps these items in your browser&apos;s local storage. They never leave your device unless you use a feature that
                sends them, such as making a plan. Items marked &quot;personal&quot; are cleared when you sign out, delete your account, or someone
                else signs in on the same browser; the theme stays, because it belongs to the device.
            </p>
            <div className="table-scroll" tabIndex={0} role="group" aria-label="Browser storage">
                <table>
                    <thead><tr><th scope="col">Key</th><th scope="col">What it holds</th><th scope="col">Personal</th></tr></thead>
                    <tbody>
                        {BROWSER_STORAGE.map(s => <tr key={s.key}><th scope="row"><code>{s.key}</code></th><td>{s.what}</td><td>{s.personal ? 'Yes' : 'No'}</td></tr>)}
                    </tbody>
                </table>
            </div>
            <LawyerNote>
                <ul>
                    <li>No cookie banner is shown, on the basis that every cookie and storage item is strictly necessary or a user-requested function (ePrivacy Directive Art. 5(3); UK PECR reg. 6). Please confirm.</li>
                </ul>
            </LawyerNote>

            <h2 id="children">Children</h2>
            <p>
                NutritionDictionary isn&apos;t for children. You must be {MINIMUM_AGE} or older to create an account, and we ask you to confirm
                it. We don&apos;t knowingly collect personal data from children under {MINIMUM_AGE}. If you think a child has given us their data,
                email <Mail /> and we&apos;ll delete it.
            </p>
            <LawyerNote>
                <ul>
                    <li>The minimum age is {MINIMUM_AGE} (COPPA). GDPR Art. 8 sets 16 as the default age for consent to online services, which member states may lower to 13, and the health-data consent here relies on Art. 9 consent. Should the EU threshold be 16, or the whole site 16 or 18?</li>
                    <li>The product roadmap says &quot;no targets for under-18s&quot;, and the AWS design suggested 18. The age is one constant, <code>MINIMUM_AGE</code> in <code>lib/legal.ts</code>.</li>
                </ul>
            </LawyerNote>

            <h2 id="transfers">International transfers</h2>
            <p>
                Our servers are in the United States (AWS us-east-1, in Virginia). Bedrock may process an AI read in another US region. If you use
                the site from outside the US, your data is transferred to the US, where privacy laws may differ from yours. For transfers from
                the EEA, UK and Switzerland we rely on <Placeholder>[TRANSFER MECHANISM: e.g. the EU-U.S. Data Privacy Framework certifications of our providers, or Standard Contractual Clauses]</Placeholder>.
            </p>

            <h2 id="security">Security</h2>
            <ul>
                <li>The site uses HTTPS, and signing in works only over HTTPS.</li>
                <li>There are no passwords to steal. Sign-in links are random, work once, expire after {RETENTION.signInLinkMinutes} minutes and are stored only as a hash.</li>
                <li>The session cookie can&apos;t be read by scripts and is sent only over HTTPS on the live site. Every change to your account must come from our own pages, which blocks forged requests from other sites.</li>
                <li>DynamoDB, where accounts live, encrypts all data at rest by default (<Ext href="https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html">AWS documentation</Ext>).</li>
                <li>Our logs identify people only by a scrambled code, never by email or IP address.</li>
                <li>Every account request is checked against the signed-in account, so no one can read another person&apos;s data by changing a link.</li>
            </ul>
            <p>
                No system is perfectly secure. If a breach affects your data, we&apos;ll tell you and the authorities as the law requires (for
                example, the FTC&apos;s Health Breach Notification Rule and state breach laws).
            </p>

            <h2 id="changes">Changes to this policy</h2>
            <p>
                When we change this policy we&apos;ll update the version and date at the top. If you have an account, we&apos;ll ask you to review
                and agree to a changed version the next time you sign in. We won&apos;t use data already collected in a materially different way
                without your consent.
            </p>

            <h2 id="contact">Contact</h2>
            <p>
                Questions or requests: <Mail />. Postal: <Placeholder>{OWNER_LEGAL_NAME}</Placeholder>, <Placeholder>{OWNER_POSTAL_ADDRESS}</Placeholder>.
            </p>
        </LegalPage>
    );
}
