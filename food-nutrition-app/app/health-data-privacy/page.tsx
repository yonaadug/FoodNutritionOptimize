import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage, { LawyerNote, Mail, Placeholder, Summary, type Section } from '@/components/legal/LegalPage';
import { GOAL_PRESETS } from '@/components/planner/goals';
import { LEGAL_PATHS, OWNER_LEGAL_NAME, RETENTION } from '@/lib/legal';

export const metadata: Metadata = {
    title: 'Consumer Health Data Privacy Policy',
    description: 'How NutritionDictionary collects, uses and shares consumer health data, and your rights under Washington, Nevada and Connecticut law.',
    alternates: { canonical: LEGAL_PATHS.healthData },
};

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

const SECTIONS: Section[] = [
    { id: 'scope', title: 'Who this covers' },
    { id: 'what', title: 'Consumer health data we collect' },
    { id: 'sources', title: 'Where it comes from' },
    { id: 'purposes', title: 'How we use it' },
    { id: 'sharing', title: 'Who we share it with' },
    { id: 'no-selling', title: 'We don\'t sell it' },
    { id: 'consent', title: 'Your consent' },
    { id: 'rights', title: 'Your rights and how to use them' },
    { id: 'state-notes', title: 'Nevada and Connecticut' },
    { id: 'contact', title: 'Contact' },
];

export default function HealthDataPrivacyPage() {
    return (
        <LegalPage
            policy="healthData"
            sections={SECTIONS}
            intro={(
                <Summary>
                    <ul>
                        <li>Some of what you save here, such as your diet goals and plans, could say something about your health. The law calls that &quot;consumer health data&quot;.</li>
                        <li>We collect it only with your separate consent, given when you sign in, and only to run the features you use.</li>
                        <li><strong>We don&apos;t sell it,</strong> use it for ads, or share it with anyone except the service providers that run the site for us.</li>
                        <li>You can see it, export it and delete it from your account page at any time.</li>
                    </ul>
                </Summary>
            )}
        >
            <h2 id="scope">Who this covers</h2>
            <p>
                This policy is for anyone who uses NutritionDictionary, run by <Placeholder>{OWNER_LEGAL_NAME}</Placeholder>. It&apos;s written to
                meet Washington&apos;s My Health My Data Act (RCW 19.373), Nevada&apos;s consumer health data law (Senate Bill 370, 2023) and
                Connecticut&apos;s rules on consumer health data (Connecticut Data Privacy Act, as amended in 2023). It adds to our{' '}
                <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link>, which covers all the data we handle.
            </p>
            <p>
                &quot;Consumer health data&quot; means personal information that is linked or reasonably linkable to you and identifies your past,
                present or future physical or mental health, including information inferred from other data.
            </p>

            <h2 id="what">Consumer health data we collect</h2>
            <p>We don&apos;t ask about medical conditions, medications, pregnancy, weight or body measurements. But these could still count as consumer health data:</p>
            <ul>
                <li>
                    <strong>Diet and nutrition goals</strong> you set in the planner: calorie ranges, nutrient minimums and limits, portion sizes,
                    and the goal preset you pick ({GOAL_PRESETS.map(p => p.title).join(', ')}, or your own). A goal such as a low carbohydrate
                    limit could suggest something about your health.
                </li>
                <li><strong>Plans</strong> you make: the foods, amounts, limits and goals in them.</li>
                <li><strong>Food history:</strong> the foods you open, with their calories and key nutrients.</li>
                <li><strong>Recipe history:</strong> recipes you analyze, with their ingredients and nutrition per serving.</li>
                <li><strong>Recipe photos and text</strong> you send to be read. We process them to answer you and don&apos;t save the photo.</li>
            </ul>
            <p>
                History is collected only while you&apos;re signed in, and only after you&apos;ve given consent. Without an account, your goals
                and plans stay in your browser and we don&apos;t keep them, though our server processes them each time you make a plan.
            </p>
            <LawyerNote>
                <ul>
                    <li>Signed-out visitors can make plans and send recipe photos or text without giving consent. The server processes these and keeps nothing, and nothing identifies the visitor except the IP address the request arrives from. Does that processing need MHMDA consent too?</li>
                    <li>There are no pregnancy, age, sex or weight inputs or presets today (checked in <code>components/planner/goals.ts</code>). The roadmap plans some (pregnancy and lactation targets), which would need this page and the consent text updated.</li>
                </ul>
            </LawyerNote>

            <h2 id="sources">Where it comes from</h2>
            <p>Only from you, through what you enter, choose and save on the site. We don&apos;t buy data or get health data from anyone else.</p>

            <h2 id="purposes">How we use it</h2>
            <ul>
                <li>To make the plans and recipe reads you ask for.</li>
                <li>To keep your history so you can see and reopen foods, recipes and plans on any device.</li>
                <li>For Plus subscribers: the week planner, grocery list and whole-plan contaminant check, which work from the same data.</li>
                <li>To keep the service secure and fix problems.</li>
            </ul>
            <p>We don&apos;t use it for advertising, to build profiles about you, to train AI models, or to make decisions about you.</p>

            <h2 id="sharing">Who we share it with</h2>
            <p>
                We don&apos;t share consumer health data with third parties or affiliates (we have no affiliates). These service providers
                (&quot;processors&quot;) handle it only on our instructions and only to run the site:
            </p>
            <ul>
                <li><strong>Amazon Web Services</strong>, which hosts the site and its database in the US.</li>
                <li><strong>Amazon Bedrock</strong> (part of AWS), which reads recipe photos and some pasted recipes with AI models AWS runs (currently Google&apos;s Gemma 3, with Amazon Nova as a backup). It doesn&apos;t use them to train models or share them with the model makers.</li>
            </ul>
            <p>
                Stripe and Google don&apos;t receive your consumer health data. We may disclose data if the law requires it, such as under a
                valid court order.
            </p>

            <h2 id="no-selling">We don&apos;t sell it</h2>
            <p>
                <strong>We don&apos;t sell consumer health data, and we won&apos;t.</strong> We also don&apos;t use geofences around places
                where people get health care, or anywhere else.
            </p>

            <h2 id="consent">Your consent</h2>
            <p>
                When you sign in, we ask for your consent to collect consumer health data in its own box, separate from agreeing to our Terms
                and Privacy Policy. You can&apos;t create an account without it, because saving your history is what an account is for. We
                record which version of this policy you agreed to and when. If we change this policy, we ask again the next time you sign in.
            </p>
            <p>
                <strong>To withdraw consent,</strong> delete your account on your <Link href="/account">account page</Link>: that stops
                collection and deletes your data. You can also email <Mail />. You can keep using the site without an account.
            </p>

            <h2 id="rights">Your rights and how to use them</h2>
            <p>You have the right to:</p>
            <ul>
                <li><strong>Confirm and access:</strong> find out whether we collect, share or sell your consumer health data, and get a copy. <em>Export my data</em> on your account page gives you everything at once.</li>
                <li><strong>See who has it:</strong> the full list is in <a href="#sharing">Who we share it with</a>. You can ask us for it by email too.</li>
                <li><strong>Delete it:</strong> single items on your <Link href="/account/history">history page</Link>, or everything with <em>Delete my account</em>. We delete it from our live database right away, and it leaves our backups within {RETENTION.backupsDays} days (<Link href={`${LEGAL_PATHS.privacy}#backups`}>how backups work</Link>). Our processors hold it only as part of our systems, so the same deletion covers them.</li>
                <li><strong>Withdraw consent:</strong> as described above.</li>
                <li><strong>Appeal:</strong> if we turn down a request, reply to our answer with &quot;Appeal&quot; and we&apos;ll respond in writing within 45 days. If you&apos;re still unhappy, you can complain to your state attorney general; in Washington, through the <Ext href="https://www.atg.wa.gov/file-complaint">Attorney General&apos;s complaint form</Ext>.</li>
            </ul>
            <p>
                Use your account page, or email <Mail /> from the address on your account. We&apos;ll answer within 45 days, and if we need
                longer (up to another 45 days) we&apos;ll tell you why. It&apos;s free, and we won&apos;t treat you differently for asking.
            </p>

            <h2 id="state-notes">Nevada and Connecticut</h2>
            <p>
                <strong>Nevada:</strong> you have the rights above, and we collect and share consumer health data only with your consent or as
                needed to provide the service you ask for. We don&apos;t sell it. <strong>Connecticut:</strong> we process consumer health data
                only with your consent, don&apos;t sell it, and limit who can access it to people bound by confidentiality.
            </p>
            <LawyerNote>
                <ul>
                    <li>Washington MHMDA: confirm it applies given where the owner is based and that the site is offered to Washington consumers (it has no revenue threshold and a private right of action under the Consumer Protection Act). The link from the homepage is in the footer on every page.</li>
                    <li>Nevada SB 370: confirm this page meets its list of required contents (for example, how a consumer can review and request changes), and whether a separate Nevada section is needed.</li>
                    <li>Connecticut: Public Act 23-56 applies the consumer health data rules (consent, no sale, confidentiality, no geofencing within 1,750 feet) to any person, regardless of size. Reportedly the 2025 amendments (SB 1295, from July 1, 2026) also bring anyone who processes sensitive data under the full CTDPA. Please confirm and say whether a data protection assessment is needed.</li>
                    <li>Is &quot;all access to staff is limited by confidentiality&quot; true in practice? Today the only person with access is the owner.</li>
                </ul>
            </LawyerNote>

            <h2 id="contact">Contact</h2>
            <p>Email <Mail />. Effective date and version are at the top of this page.</p>
        </LegalPage>
    );
}
