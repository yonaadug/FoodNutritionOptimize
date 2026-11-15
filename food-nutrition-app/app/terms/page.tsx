import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage, { LawyerNote, Mail, Placeholder, Summary, type Section } from '@/components/legal/LegalPage';
import { GOVERNING_LAW, LEGAL_PATHS, MINIMUM_AGE, OWNER_LEGAL_NAME, PLUS, REFUND_POLICY } from '@/lib/legal';

export const metadata: Metadata = {
    title: 'Terms of Use',
    description: 'The terms for using NutritionDictionary and NutritionDictionary Plus.',
    alternates: { canonical: LEGAL_PATHS.terms },
};

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

const SECTIONS: Section[] = [
    { id: 'agreement', title: 'These terms' },
    { id: 'not-medical-advice', title: 'Not medical advice' },
    { id: 'contaminants', title: 'Contaminant meters' },
    { id: 'ai', title: 'AI recipe reads' },
    { id: 'accounts', title: 'Accounts' },
    { id: 'acceptable-use', title: 'Acceptable use' },
    { id: 'plus', title: 'NutritionDictionary Plus' },
    { id: 'ip', title: 'Our content and data sources' },
    { id: 'your-content', title: 'Your content' },
    { id: 'disclaimers', title: 'Disclaimers' },
    { id: 'liability', title: 'Limits of liability' },
    { id: 'ending', title: 'Ending your use' },
    { id: 'law', title: 'Governing law' },
    { id: 'changes', title: 'Changes to these terms' },
    { id: 'contact', title: 'Contact' },
];

export default function TermsPage() {
    return (
        <LegalPage
            policy="terms"
            sections={SECTIONS}
            intro={(
                <Summary>
                    <ul>
                        <li>NutritionDictionary gives general nutrition information. It isn&apos;t medical advice.</li>
                        <li>Numbers are estimates, and AI reads of recipes can be wrong: check them.</li>
                        <li>Plus renews automatically until you cancel, which you can do at any time in the subscription portal.</li>
                    </ul>
                </Summary>
            )}
        >
            <h2 id="agreement">These terms</h2>
            <p>
                These terms are an agreement between you and <Placeholder>{OWNER_LEGAL_NAME}</Placeholder> (&quot;we&quot;, &quot;us&quot;), which
                runs NutritionDictionary at nutritiondictionary.com. By using the site you agree to them. When you create an account we ask you
                to agree to them explicitly. Our <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link> and{' '}
                <Link href={LEGAL_PATHS.healthData}>Consumer Health Data Privacy Policy</Link> explain how we handle your data.
            </p>

            <h2 id="not-medical-advice">Not medical advice</h2>
            <p>
                <strong>NutritionDictionary is a general information and planning tool. It doesn&apos;t give medical, dietetic or nutritional
                advice, and it doesn&apos;t replace a doctor or registered dietitian.</strong> Nutrition values are estimates from public data
                and can differ from the food you eat. Plans are worked out by a computer to meet the goals you enter. They can be unusual, they
                don&apos;t know your health, and they may not suit you.
            </p>
            <p>
                Talk to a qualified professional before changing your diet, especially if you are pregnant or breastfeeding, under 18, have a
                medical condition, take medication, or have a history of disordered eating. In an emergency, contact your local emergency
                services.
            </p>

            <h2 id="contaminants">Contaminant meters</h2>
            <p>
                The meters for metals, pesticides and microplastics are <strong>general information</strong>. They show typical levels from
                public testing programs, compared with cautious reference values from public agencies. They don&apos;t measure any particular
                product, a low reading doesn&apos;t mean none, and a high reading doesn&apos;t mean a food is unsafe. Microplastic meters compare
                studied foods and don&apos;t rate safety. Our <Link href="/methodology">methodology page</Link> explains how they work and their
                limits.
            </p>

            <h2 id="ai">AI recipe reads</h2>
            <p>
                The recipe reader uses AI models running on Amazon Bedrock (currently Google&apos;s Gemma 3, operated by AWS, with Amazon Nova as a
                backup) to read photos and some pasted recipes.
                <strong> AI reads can be wrong:</strong> it can miss or invent ingredients, misread amounts, or pick the wrong food. Photos of
                plated food are especially rough. Check every ingredient and amount before you rely on the result. You&apos;re responsible for
                what you do with it.
            </p>

            <h2 id="accounts">Accounts</h2>
            <ul>
                <li>You don&apos;t need an account to use the site. To create one you must be {MINIMUM_AGE} or older, and if you&apos;re under the age of majority where you live, you need a parent or guardian&apos;s permission.</li>
                <li>You sign in with a link sent to your email or with Google. Keep your email account secure: anyone who can read your email can sign in as you.</li>
                <li>An account is for one person. Tell us at <Mail /> if you think someone else has used yours.</li>
                <li>You can export or delete your account at any time from your <Link href="/account">account page</Link>.</li>
            </ul>
            <LawyerNote>
                <ul>
                    <li>The minimum age is a constant (<code>MINIMUM_AGE = {MINIMUM_AGE}</code>). Confirm 13, or choose 16 or 18; and confirm whether parental permission wording is wanted for minors.</li>
                </ul>
            </LawyerNote>

            <h2 id="acceptable-use">Acceptable use</h2>
            <p>Please don&apos;t:</p>
            <ul>
                <li>break the law, or use the site to harm anyone;</li>
                <li>try to get into accounts or data that aren&apos;t yours, or test the site&apos;s security without our written permission;</li>
                <li>overload the site, get around its limits, or scrape or copy it in bulk with automated tools;</li>
                <li>send content you don&apos;t have the right to send, or anything illegal, abusive or malicious, including in photos;</li>
                <li>try to make the AI do anything other than read a recipe;</li>
                <li>resell or redistribute the service, or pass off its output as professional advice.</li>
            </ul>
            <p>We may limit, suspend or close access that breaks these rules or puts the site or other people at risk.</p>

            <h2 id="plus">NutritionDictionary Plus</h2>
            <p>
                Plus is an optional subscription that adds a monthly AI photo allowance, unlimited saved plans and recipes on every device, a week
                planner with a grocery list, and a contaminant check across a whole plan. Food pages, contaminant meters, the one-day planner,
                pasted-text recipes and data export stay free.
            </p>
            <h3>Price and automatic renewal</h3>
            <p>
                <strong>
                    Plus costs {PLUS.monthlyPrice} per month or {PLUS.annualPrice} per year, plus any applicable tax. It renews automatically at the
                    end of each month or year, and we charge the card you gave Stripe at each renewal, until you cancel.
                </strong>{' '}
                We show the price, the renewal period and how to cancel before you subscribe, and Stripe emails a receipt for each payment.
            </p>
            <h3>Free trial</h3>
            <p>
                New accounts get a {PLUS.trialDays}-day trial of Plus with a capped AI allowance. It needs no card and{' '}
                <strong>never turns into a paid subscription by itself</strong>: when it ends, your account goes back to the free plan unless you
                choose to subscribe.
            </p>
            <h3>Cancelling</h3>
            <p>
                Cancel any time in the subscription portal: on your <Link href="/account">account page</Link>, choose the option to manage your
                subscription. Cancelling stops future renewals, and you keep Plus until the end of the period you&apos;ve paid for. You can
                also email <Mail /> to cancel.
            </p>
            <h3>Refunds</h3>
            <p><Placeholder>{REFUND_POLICY}</Placeholder> This doesn&apos;t limit any refund rights your local law gives you.</p>
            <h3>Price changes</h3>
            <p>
                If we change the price, we&apos;ll email you at least <Placeholder>[30]</Placeholder> days before it applies to you, and the new
                price starts at your next renewal after that. If you don&apos;t want to pay it, cancel before then.
            </p>
            <h3>Failed payments</h3>
            <p>
                If a renewal payment fails, Stripe retries it and emails you. If it still fails, the subscription is cancelled and your account
                returns to the free plan.
            </p>
            <LawyerNote title="Auto-renewal checklist for the lawyer">
                <ul>
                    <li><strong>California Automatic Renewal Law</strong> (Bus. &amp; Prof. Code §§ 17600–17606, as amended by AB 2863 from July 1, 2025): clear and conspicuous terms before purchase, next to the subscribe button; express affirmative consent to the auto-renewal terms, separate from other terms; an acknowledgment after purchase with the terms and how to cancel; online cancellation as easy as signing up; annual reminders and notice before material changes. Does a no-card trial that never converts trigger any free-trial notice duty?</li>
                    <li><strong>New York</strong> (Gen. Bus. Law §§ 527–527-a): clear and conspicuous disclosure, affirmative consent, an acknowledgment that explains cancellation, and an easy cancellation mechanism.</li>
                    <li><strong>Federal:</strong> the Restore Online Shoppers&apos; Confidence Act (15 U.S.C. §§ 8401–8405) still applies. The FTC&apos;s 2024 &quot;click to cancel&quot; rule was vacated by the Eighth Circuit in 2025: confirm its current status and any other states&apos; laws (for example Colorado, Illinois, Minnesota, Virginia).</li>
                    <li>These terms alone don&apos;t meet those laws. The checkout page must show the disclosure and get the consent; that&apos;s for the billing work (<code>app/plus</code>), with this page as the reference.</li>
                    <li>Whether the Stripe Customer Portal&apos;s cancel flow, set to cancel at the end of the period, satisfies &quot;easy online cancellation&quot;.</li>
                    <li>Refund policy, the price-change notice period, and EU/UK consumer rights (14-day withdrawal right for digital services, and the waiver wording if service starts at once).</li>
                </ul>
            </LawyerNote>

            <h2 id="ip">Our content and data sources</h2>
            <p>
                The site&apos;s design, text and code belong to us or our licensors. The data comes from public sources, which we credit:
            </p>
            <ul>
                <li><strong>Nutrition:</strong> <Ext href="https://fdc.nal.usda.gov/">USDA FoodData Central</Ext>, which is in the public domain.</li>
                <li><strong>Contaminants:</strong> US FDA (Total Diet Study, mercury in fish, arsenic in rice), USDA Pesticide Data Program and US EPA reference values, all US government works in the public domain; EFSA and ATSDR reference values, cited with attribution; and published microplastics studies (Cox et al. 2019, Kosuth et al. 2018, Milne et al. 2024, Danopoulos et al. 2020), whose values we cite with attribution. The full list, with links, is on our <Link href="/methodology#sources">methodology page</Link>.</li>
            </ul>
            <p>Government agencies and study authors don&apos;t endorse NutritionDictionary.</p>
            <LawyerNote>
                <ul>
                    <li>Milne et al. 2024 is published under CC BY-NC-ND 4.0, and the site will have paid features. Its values are still in the data, and this is open in <code>TODO.md</code>. Decide whether citing its numbers is allowed, or remove those rows (<code>data/contaminants/microplastics.tsv</code>).</li>
                    <li>Cox et al. 2019 is &copy; ACS; we cite numeric values only. Kosuth et al. 2018 is CC BY. Confirm attribution is enough for both.</li>
                    <li>AI outputs: confirm the AWS Service Terms for Amazon Bedrock, Google&apos;s Gemma Terms of Use and Prohibited Use Policy (check whether AWS&apos;s terms for Gemma 3 on Bedrock pass them through), and the Amazon Nova terms allow showing model output to users in a paid product, and who owns it. Anthropic&apos;s terms matter only if Claude is switched back on.</li>
                </ul>
            </LawyerNote>

            <h2 id="your-content">Your content</h2>
            <p>
                Recipes, photos and other things you send stay yours. You give us permission to process them only to run the features you use,
                for example to read a recipe and save it to your history. You must have the right to send them. Ingredient lists and facts
                aren&apos;t protected by copyright, but recipe photos and written instructions can be, so only send photos you took or may use.
            </p>
            <p>If you send us feedback or ideas, we may use them without owing you anything.</p>

            <h2 id="disclaimers">Disclaimers</h2>
            <p>
                The site is provided &quot;as is&quot; and &quot;as available&quot;. To the extent the law allows, we make no promises that it will
                be accurate, complete, uninterrupted or error-free, or fit for any particular purpose. Nutrition and contaminant data can be out
                of date or wrong, and food varies.
            </p>

            <h2 id="liability">Limits of liability</h2>
            <p>
                To the extent the law allows, we aren&apos;t liable for indirect, incidental, special or consequential losses, or for any decision
                you make about your diet or health based on the site. Our total liability for any claim about the site is limited to the greater
                of the amount you paid us in the 12 months before the claim and <Placeholder>[US$ AMOUNT]</Placeholder>.
            </p>
            <p>
                Some places don&apos;t allow these limits, so they may not apply to you. Nothing in these terms limits liability that can&apos;t be
                limited by law, such as for death or personal injury caused by negligence, or for fraud, or takes away rights you have as a
                consumer.
            </p>

            <h2 id="ending">Ending your use</h2>
            <p>
                You can stop using the site and delete your account at any time. We may suspend or close an account that breaks these terms, or
                stop offering the site, with notice where we reasonably can. If we stop offering Plus:{' '}
                <Placeholder>[WHAT HAPPENS TO PREPAID PERIODS, E.G. A PRO-RATA REFUND]</Placeholder>.
            </p>

            <h2 id="law">Governing law</h2>
            <p>
                These terms are governed by <Placeholder>{GOVERNING_LAW}</Placeholder>. If you&apos;re a consumer in the EU or UK, you also keep
                the protection of the mandatory laws of the country where you live and can bring claims there.
            </p>

            <h2 id="changes">Changes to these terms</h2>
            <p>
                We may update these terms. We&apos;ll change the version and date at the top, and if you have an account we&apos;ll ask you to
                agree to the new version the next time you sign in. Changes to Plus pricing follow the notice rule above.
            </p>

            <h2 id="contact">Contact</h2>
            <p>Email <Mail />.</p>
        </LegalPage>
    );
}
