import type { Metadata } from 'next';
import IntentLink from '@/components/ui/IntentLink';

export const metadata: Metadata = {
    title: 'How we source and match our data',
    description: 'How NutritionDictionary reads contaminant testing, which health references it uses, how similar foods share data, and how gaps in USDA nutrition data are filled.',
    alternates: { canonical: '/methodology' },
};

/** A link to a source, off this site. */
function Src({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

/**
 * The customer-facing version of docs/CONTAMINANT_DATA.md, hand-written so the site needs
 * no Markdown renderer. lib/methodology.test.ts checks that every source in that document
 * is cited here, so the two can't quietly drift apart.
 */
export default function MethodologyPage() {
    return (
        <main className="container food-page">
            <nav aria-label="Breadcrumb" className="breadcrumb">
                <ol>
                    <li><IntentLink href="/">Foods</IntentLink></li>
                    <li aria-current="page">How we source our data</li>
                </ol>
            </nav>

            <article className="panel prose">
                <h1 className="section-title">How we show contaminants in food</h1>
                <p>
                    Most foods contain traces of metals, and many have pesticide residues. On each food page, NutritionDictionary shows how much one serving
                    typically contains, using public testing data, so you can compare foods without reading raw numbers.
                </p>
                <p>
                    <strong>This is general information, not medical advice.</strong> It shows typical levels, not what&apos;s in any one package.
                    If you&apos;re pregnant, feeding young children or have health concerns, talk to your clinician.
                </p>
                <p className="small secondary">
                    On this page: <a href="#read-a-meter">Reading a meter</a> · <a href="#rows">What each row can say</a> · <a href="#references">Reference levels</a> ·{' '}
                    <a href="#similar-foods">How similar foods share data</a> · <a href="#sources">Sources</a> · <a href="#older-entries">Gaps in nutrition data</a>
                </p>

                <h2 id="read-a-meter">How to read a meter</h2>
                <p>Each meter compares one serving with a health-based reference from a public agency. It updates when you change the serving size.</p>
                <div className="table-scroll" tabIndex={0} role="group" aria-label="What each level means">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">Level</th>
                                <th scope="col">Lead, cadmium, arsenic, pesticides (share of a <strong>day&apos;s</strong> reference)</th>
                                <th scope="col">Mercury (share of a <strong>week&apos;s</strong> reference)</th>
                                <th scope="col">Microplastics (particles per serving, <strong>not a safety rating</strong>)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><th scope="row">Low</th><td>under 10%</td><td>under 10%</td><td>under 10</td></tr>
                            <tr><th scope="row">Moderate</th><td>10% to under 25%</td><td>10% to under 33%</td><td>10 to under 50</td></tr>
                            <tr><th scope="row">Elevated</th><td>25% to under 50%</td><td>33% to under 100%</td><td>50 to under 200</td></tr>
                            <tr><th scope="row">High</th><td>50% or more</td><td>100% or more</td><td>200 or more</td></tr>
                        </tbody>
                    </table>
                </div>
                <p><strong>Why these lines?</strong> You eat many foods in a day, so a single serving that uses half a day&apos;s reference counts as high. These lines are our own judgment and don&apos;t come from an agency.</p>
                <p><strong>Why is mercury weekly?</strong> Mercury leaves the body slowly, and most people don&apos;t eat fish daily. Our mercury lines match the FDA/EPA fish advice: a 4 oz serving at the top of their &ldquo;Best Choices&rdquo; group is 32% of the week, and at the top of &ldquo;Good Choices&rdquo; is 99%.</p>
                <p><strong>A low reading doesn&apos;t mean none, and a high reading doesn&apos;t mean harm.</strong> Reference levels are cautious planning values, not a line between safe and harmful. FDA says no safe level of lead exposure is known. Exposure adds up across everything you eat, over time. Eating a variety of foods is the most practical way to limit it.</p>

                <h2 id="rows">What each row can say</h2>
                <ul>
                    <li><strong>A level</strong> (low to high): we have measurements for this food or a close match.</li>
                    <li><strong>Not detected:</strong> testing found none, down to the test&apos;s limit. Tiny amounts can&apos;t be ruled out.</li>
                    <li><strong>Not rated:</strong> we show the amount without a judgment. This applies to total arsenic in seafood, which is mostly organic forms considered far less harmful.</li>
                    <li><strong>No data:</strong> nobody has published testing we could match to this food. That tells you nothing either way, and we never show it as zero.</li>
                    <li><strong>Rough estimate:</strong> the number rests on few samples, a loose match or old data.</li>
                </ul>

                <h2 id="references">Reference levels</h2>
                <div className="table-scroll" tabIndex={0} role="group" aria-label="Reference levels used">
                    <table>
                        <thead>
                            <tr><th scope="col">Contaminant</th><th scope="col">Reference</th><th scope="col">Set by</th><th scope="col">Notes</th></tr>
                        </thead>
                        <tbody>
                            <tr>
                                <th scope="row">Lead</th>
                                <td>8.8 mcg per day</td>
                                <td><Src href="https://www.fda.gov/food/environmental-contaminants-food/lead-food-and-foodwares">FDA</Src>, 2022</td>
                                <td>Set for women of childbearing age. FDA&apos;s level for children is lower, at 2.2 mcg per day. Details show both.</td>
                            </tr>
                            <tr>
                                <th scope="row">Cadmium</th>
                                <td>0.21 mcg per kg of body weight per day</td>
                                <td><Src href="https://www.fda.gov/food/environmental-contaminants-food/cadmium-food-and-foodwares">FDA</Src>, 2023</td>
                                <td>Lower end of FDA&apos;s range.</td>
                            </tr>
                            <tr>
                                <th scope="row">Mercury</th>
                                <td>0.1 mcg per kg per day, shown per week</td>
                                <td><Src href="https://iris.epa.gov/ChemicalLanding/&substance_nmbr=73">EPA</Src>, 2001</td>
                                <td>Basis of the <Src href="https://www.fda.gov/food/metals/technical-information-development-fish-consumption-advice-fdaepa-advice-what-pregnant-women-and">FDA/EPA fish advice</Src>. Treats all mercury as methylmercury, as they do.</td>
                            </tr>
                            <tr>
                                <th scope="row">Inorganic arsenic</th>
                                <td>0.06 mcg per kg per day</td>
                                <td><Src href="https://iris.epa.gov/ChemicalLanding/&substance_nmbr=278">EPA</Src>, 2025</td>
                                <td>Covers non-cancer effects only, and EPA also classes inorganic arsenic as a carcinogen. This value is cautious: EPA estimates typical US intake is already about 61% of it. Details also show the older <Src href="https://wwwn.cdc.gov/TSP/MRLS/mrlsListing.aspx">ATSDR</Src> value, five times higher.</td>
                            </tr>
                            <tr>
                                <th scope="row">Pesticides</th>
                                <td>EPA&apos;s dose for each pesticide</td>
                                <td>
                                    <Src href="https://www.epa.gov/system/files/documents/2021-07/hh-benchmarks-table-2021.pdf">EPA 2021</Src>,{' '}
                                    <Src href="https://www.epa.gov/system/files/documents/2022-01/dwtable2018.pdf">EPA 2018</Src>,{' '}
                                    <Src href="https://iris.epa.gov/ChemicalLanding/&substance_nmbr=147">EPA IRIS</Src>
                                </td>
                                <td>See below.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>We assume an 80 kg adult, or 75 kg for mercury to match the fish advice. A lighter person&apos;s share is higher.</p>

                <h3>Pesticides</h3>
                <p>USDA tests samples for hundreds of pesticides. For each food, we take the average level of each pesticide across all samples, counting samples without it as zero, and work out its share of EPA&apos;s reference dose. The meter adds those shares together. That&apos;s cautious, since EPA combines only pesticides that act the same way.</p>
                <p>We don&apos;t compare with legal tolerances. EPA describes a tolerance as the level that triggers enforcement, so it isn&apos;t a health limit. Details still show how many samples went over one. Across all foods in 2024, <Src href="https://www.ams.usda.gov/sites/default/files/media/PDPAnnualSummary.pdf">USDA reports</Src> that over 99% of samples were below tolerances and 42.3% had no detectable residue.</p>
                <p>USDA washes or peels produce as you would at home before testing. Cooking and processing can change residues, and we don&apos;t adjust for that. Some foods were last tested years ago, and the details say when.</p>

                <h3>Arsenic</h3>
                <p>Most testing measures total arsenic, which mixes the more harmful inorganic form with far less harmful organic forms.</p>
                <ul>
                    <li><strong>Rice:</strong> we use FDA&apos;s measurements of inorganic arsenic by rice type.</li>
                    <li><strong>Seafood:</strong> the arsenic is mostly organic, so we show the amount without a rating.</li>
                    <li><strong>Other foods:</strong> we count all of the arsenic as inorganic. The real figure is probably lower, so these rows say &ldquo;at most&rdquo;.</li>
                </ul>
                <p><strong>Rice often reads high.</strong> That&apos;s mainly because EPA&apos;s reference is so cautious, and FDA doesn&apos;t advise avoiding rice. FDA found that <Src href="https://www.fda.gov/food/environmental-contaminants-food/what-you-can-do-limit-exposure-arsenic">cooking rice in plenty of water</Src> and draining it removes 40-60% of inorganic arsenic, though also some added nutrients. Rinsing alone has little effect. Eating a variety of grains helps too.</p>

                <h3>Microplastics: limited data</h3>
                <p><strong>No health limit exists, so this meter compares studied foods. It doesn&apos;t rate safety.</strong> FDA says current evidence <Src href="https://www.fda.gov/food/environmental-contaminants-food/microplastics-and-nanoplastics-foods">does not demonstrate</Src> that the levels found in food pose a risk to human health.</p>
                <p>The science is young. Studies count particles of different sizes in different ways, and many counted particles were never chemically confirmed as plastic. Results for one food can differ a thousandfold between studies, so treat these numbers as rough.</p>

                <h2 id="plan-totals">Totals for a whole plan</h2>
                <p>A day or week plan adds up each food at its planned amount, using the same per-serving figure as that food&apos;s page. Lead, cadmium, inorganic arsenic and pesticides are compared with a <strong>day&apos;s</strong> reference (a week plan uses its average day and also names the highest day). Mercury is compared with the <strong>week&apos;s</strong> reference: a day plan shows that day&apos;s share of it, and a week plan shows the real total of all 7 days.</p>
                <p>A food&apos;s meter on its own page leaves room for everything else you eat that day. A plan total already is the day (or week), so its lines are wider: low is under 25% of the reference, moderate 25% to under 50%, elevated 50% to under 100%, and high is over the whole reference. A day&apos;s mercury keeps the fish-advice lines above, because one day of fish is one serving&apos;s worth of the week.</p>
                <p>When a total reaches elevated, the plan names the foods that push it there and offers to reduce, swap or leave them out. Foods without data are listed as unknown and never counted as zero, so a total with unknowns is &ldquo;at least&rdquo; that much. Microplastics are added up for comparison only: there is no health limit, so they are never rated.</p>

                <h2 id="similar-foods">How similar foods share data</h2>
                <p>Testing programs measure a food once, while USDA lists many versions of it. &ldquo;Eggs, Grade A, Large&rdquo; and &ldquo;Egg, whole, raw, fresh&rdquo; don&apos;t need separate measurements, so they point to the same FDA record, and the panel names what was actually tested under <strong>Based on</strong>.</p>
                <p>Each link has a confidence score, shown in the details. Some foods are too different to share data, so we leave them without any:</p>
                <ul>
                    <li><strong>Organ meats</strong>, because liver and kidney concentrate cadmium, so muscle meat is a poor stand-in.</li>
                    <li><strong>Mixed dishes</strong>, unless FDA tested that dish.</li>
                    <li><strong>Brands:</strong> a brand name maps to the general food. Levels in a specific product can differ.</li>
                </ul>
                <p><strong>Raw versus cooked.</strong> Water dilutes contaminants, so a gram of dry rice holds more than a gram of cooked rice. Where the forms differ noticeably, we scale using USDA&apos;s water and fat figures. The details say when we have.</p>
                <p><strong>Averages hide variation.</strong> Levels change with soil, region, fish size and season. Non-detects count as zero in averages, as FDA does, and details also show the higher figure if undetected samples sat just under the test&apos;s limit.</p>

                <h2 id="sources">Sources</h2>
                <h3>Heavy metals</h3>
                <ul>
                    <li>US FDA. <Src href="https://www.fda.gov/food/fda-total-diet-study-tds/fda-total-diet-study-tds-results">Total Diet Study, FY2018-FY2020 elements</Src>. Public domain.</li>
                    <li>US FDA. <Src href="https://www.fda.gov/food/environmental-contaminants-food/mercury-levels-commercial-fish-and-shellfish-1990-2012">Mercury Levels in Commercial Fish and Shellfish, 1990-2012</Src>. Public domain.</li>
                    <li>US FDA. <Src href="https://www.fda.gov/files/food/published/Arsenic-in-Rice-and-Rice-Products-Risk-Assessment-Report-PDF.pdf">Arsenic in Rice and Rice Products Risk Assessment</Src>, revised March 2016, Table 4.2.</li>
                </ul>
                <h3>Pesticides</h3>
                <ul>
                    <li>USDA Agricultural Marketing Service. <Src href="https://www.ams.usda.gov/datasets/pdp/pdpdata">Pesticide Data Program, 2016-2024</Src>, and <Src href="https://www.ams.usda.gov/sites/default/files/media/PDPAnnualSummary.pdf">2024 Annual Summary</Src>. Public domain.</li>
                    <li>US EPA. <Src href="https://www.epa.gov/system/files/documents/2021-07/hh-benchmarks-table-2021.pdf">Human Health Benchmarks for Pesticides, 2021</Src>. Public domain.</li>
                    <li>US EPA. <Src href="https://www.epa.gov/system/files/documents/2022-01/dwtable2018.pdf">2018 Drinking Water Standards and Health Advisories Tables</Src>. Public domain.</li>
                    <li>US EPA. <Src href="https://iris.epa.gov/ChemicalLanding/&substance_nmbr=147">IRIS: p,p&apos;-DDT</Src>. Public domain.</li>
                </ul>
                <h3>Reference levels and advice</h3>
                <ul>
                    <li>US FDA. <Src href="https://www.fda.gov/food/environmental-contaminants-food/lead-food-and-foodwares">Lead in Food and Foodwares</Src>, <Src href="https://www.fda.gov/food/environmental-contaminants-food/cadmium-food-and-foodwares">Cadmium in Food and Foodwares</Src>, and <Src href="https://www.fda.gov/food/environmental-contaminants-food/what-you-can-do-limit-exposure-arsenic">What You Can Do to Limit Exposure to Arsenic</Src>.</li>
                    <li>US FDA and EPA. <Src href="https://www.fda.gov/food/metals/technical-information-development-fish-consumption-advice-fdaepa-advice-what-pregnant-women-and">Technical information on the fish advice</Src>.</li>
                    <li>US EPA. <Src href="https://iris.epa.gov/ChemicalLanding/&substance_nmbr=73">IRIS: Methylmercury</Src>, <Src href="https://iris.epa.gov/ChemicalLanding/&substance_nmbr=278">IRIS: Inorganic Arsenic</Src>.</li>
                    <li>EFSA. <Src href="https://www.efsa.europa.eu/en/topics/topic/metals-contaminants-food">Metals as contaminants in food</Src>.</li>
                    <li>ATSDR. <Src href="https://wwwn.cdc.gov/TSP/MRLS/mrlsListing.aspx">Minimal Risk Levels</Src>.</li>
                </ul>
                <h3>Microplastics</h3>
                <ul>
                    <li>Cox KD, et al. <Src href="https://doi.org/10.1021/acs.est.9b01517">Human Consumption of Microplastics</Src>. Environ Sci Technol. 2019;53(12):7068-7074.</li>
                    <li>Kosuth M, Mason SA, Wattenberg EV. <Src href="https://doi.org/10.1371/journal.pone.0194970">Anthropogenic contamination of tap water, beer, and sea salt</Src>. PLoS ONE. 2018;13(4):e0194970.</li>
                    <li>Milne MH, et al. <Src href="https://doi.org/10.1016/j.envpol.2023.123233">Exposure of U.S. adults to microplastics from commonly-consumed proteins</Src>. Environ Pollut. 2024;343:123233.</li>
                    <li>Danopoulos E, et al. <Src href="https://doi.org/10.1289/EHP7171">Microplastic contamination of seafood intended for human consumption</Src>. Environ Health Perspect. 2020;128(12):126002.</li>
                    <li>US FDA. <Src href="https://www.fda.gov/food/environmental-contaminants-food/microplastics-and-nanoplastics-foods">Microplastics and Nanoplastics in Foods</Src>.</li>
                </ul>

                <h2 id="older-entries">Gaps in nutrition data</h2>
                <p>
                    USDA&apos;s newest records, called Foundation Foods, are carefully measured but don&apos;t cover every nutrient. Where a food has also been published in USDA&apos;s older
                    SR Legacy dataset, and the newer record has no value for a nutrient, we use the older entry&apos;s value for that nutrient. A food then has one set of values everywhere on the site.
                </p>
                <ul>
                    <li>A value measured in the newer record is always kept, including a measured zero.</li>
                    <li>
                        Only gaps are filled, and only from the older entry for the same food: the one with the same USDA food number, or, where USDA gave the
                        newer record a new number, the one we matched by hand as the exact same item (same species or variety, the same cut, raw or cooked the same way).
                    </li>
                    <li>Where a food is in both datasets, only the newer record is listed. The older entry&apos;s page points to it.</li>
                    <li>Every filled value is marked <strong>†</strong> wherever it appears, on the food&apos;s page, in a plan and in a recipe, and the food&apos;s page links to the older entry.</li>
                </ul>
                <p>Older entries are sometimes a different sample or variety, so treat these values as a good estimate. &ldquo;—&rdquo; means neither entry has a value, which isn&apos;t the same as zero.</p>
            </article>
        </main>
    );
}
