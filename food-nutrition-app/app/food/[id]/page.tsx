import type { Metadata } from 'next';
import IntentLink from '@/components/ui/IntentLink';
import { notFound, permanentRedirect } from 'next/navigation';
import { getFoodByFdcId, getFoodTypes, getRelatedFoods } from '@/lib/db';
import { foodGroupOf } from '@/lib/food-groups';
import type { Food } from '@/lib/food-types';
import { categorySlug, datasetInfo, fdcUrl, fmt, foodPath, formatPublicationDate, nutrientName, parseFoodParam, resultNutrients } from '@/lib/food-page';
import { filledKeys } from '@/lib/nutrient-fill';
import { typicalServing } from '@/lib/servings';
import { scaleAmount } from '@/lib/serving-scale';
import { dataSourceLabel, displayFoodName, hasCoreData, nv, splitFoodName } from '@/components/planner/nutrients';
import { DatasetBadge } from '@/components/explore/FoodResultRow';
import FoodCard from '@/components/explore/FoodCard';
import FoodDetail from '@/components/food/FoodDetail';
import Icon from '@/components/ui/Icon';

async function loadFood(idParam: string): Promise<Food | null> {
    const parsed = parseFoodParam(idParam);
    if (!parsed) return null;
    return (await getFoodByFdcId(parsed.fdcId)) ?? null;
}

const displayName = (food: Food) => displayFoodName(food.description);

export async function generateMetadata({ params }: PageProps<'/food/[id]'>): Promise<Metadata> {
    const food = await loadFood((await params).id);
    if (!food) return { title: 'Food not found', robots: { index: false } };

    const title = `${displayName(food)}: nutrition facts`;
    const serving = typicalServing(food.serving_sizes, food);
    const kcal = nv(food, 'calories');
    const amounts = resultNutrients(food, serving.grams, 3).map(n => `${fmt(n.amount)} ${n.unit} ${n.label.replace(/ \(.*\)$/, '').toLowerCase()}`);
    const description = `${food.description}, per ${serving.label}: ${kcal === null ? '' : `${fmt(scaleAmount(kcal, serving.grams), 0)} calories, `}${amounts.join(', ')}. Full vitamins and minerals with % Daily Value, from USDA FoodData Central.`;
    // A superseded record's page is a pointer: the replacement is the page to index.
    const replacement = food.superseded_by_fdc_id ? await getFoodByFdcId(food.superseded_by_fdc_id) : undefined;
    const canonical = foodPath(replacement ?? food);

    return {
        title,
        description,
        alternates: { canonical },
        openGraph: { type: 'article', title, description, url: foodPath(food) },
        twitter: { card: 'summary', title, description },
    };
}

export default async function FoodPage({ params }: PageProps<'/food/[id]'>) {
    const { id } = await params;
    const food = await loadFood(id);
    if (!food) notFound();

    const canonical = foodPath(food);
    if (`/food/${id}` !== canonical) permanentRedirect(canonical);

    const [related, replacement, types] = await Promise.all([
        getRelatedFoods(food),
        food.superseded_by_fdc_id ? getFoodByFdcId(food.superseded_by_fdc_id) : Promise.resolve(undefined),
        getFoodTypes(food),
    ]);
    const { name, detail } = splitFoodName(food.description);
    const dataset = datasetInfo(food.data_type);
    const published = formatPublicationDate(food.publication_date);
    const compareSuggestions = [...related.forms.slice(0, 5), ...related.similar.slice(0, 3)];
    // The Type switcher lists this food's types: "Other forms" keeps only the forms it doesn't.
    const typeIds = new Set(types.map(t => t.id));
    const otherForms = related.forms.filter(f => !typeIds.has(f.id));
    const filled = filledKeys(food);
    const olderEntry = filled.length > 0 ? food.filledFrom![filled[0]] : null;

    return (
        <main className="container food-page">
            <nav aria-label="Breadcrumb" className="breadcrumb">
                <ol>
                    <li><IntentLink href="/">Foods</IntentLink></li>
                    {food.food_category && <li><IntentLink href={`/food/category/${categorySlug(food.food_category)}`}>{food.food_category}</IntentLink></li>}
                    <li aria-current="page">{name}</li>
                </ol>
            </nav>

            <header className="food-head">
                <h1>{name}{detail && <span className="food-head-detail">{detail}</span>}</h1>
                <div className="food-meta">
                    <DatasetBadge dataType={food.data_type} />
                    {!hasCoreData(food) && <span className="chip chip-warn"><Icon name="alert" size={12} /> Limited data</span>}
                </div>
            </header>

            {replacement && (
                <div className="callout callout-info" role="note">
                    <span className="callout-icon"><Icon name="info" /></span>
                    <span>
                        USDA has newer measurements for this food.{' '}
                        <IntentLink href={foodPath(replacement)}>See {displayName(replacement)} in {datasetInfo(replacement.data_type).name}</IntentLink>.
                        This older {dataset.name} record is kept for reference.
                    </span>
                </div>
            )}

            <FoodDetail food={food} compareSuggestions={compareSuggestions} types={types} groupName={foodGroupOf(food.description).name} />

            {otherForms.length > 0 && (
                <section aria-labelledby="forms-title">
                    <h2 className="browse-title" id="forms-title">Other forms of {name.toLowerCase()}</h2>
                    <ul className="food-grid">
                        {otherForms.map(f => <li key={f.id}><FoodCard food={f} /></li>)}
                    </ul>
                </section>
            )}

            {related.similar.length > 0 && (
                <section aria-labelledby="similar-title">
                    <h2 className="browse-title" id="similar-title">Nutritionally similar foods</h2>
                    <ul className="food-grid">
                        {related.similar.map(f => <li key={f.id}><FoodCard food={f} /></li>)}
                    </ul>
                </section>
            )}

            <section className="panel provenance" aria-labelledby="source-title">
                <h2 className="panel-title" id="source-title">Where this data comes from</h2>
                <p className="small secondary">{dataset.blurb}</p>
                <dl className="provenance-list small">
                    <div>
                        <dt>Dataset</dt>
                        <dd>USDA FoodData Central, {dataset.name}</dd>
                    </div>
                    <div>
                        <dt>FDC ID</dt>
                        <dd>
                            <a href={fdcUrl(food.fdc_id)} target="_blank" rel="noreferrer">
                                {food.fdc_id} <Icon name="external" size={13} /><span className="sr-only"> (opens USDA FoodData Central in a new tab)</span>
                            </a>
                        </dd>
                    </div>
                    {published && (
                        <div>
                            <dt>Published</dt>
                            <dd>{published}</dd>
                        </div>
                    )}
                    {food.source_release && (
                        <div>
                            <dt>Release used</dt>
                            <dd>{food.source_release}</dd>
                        </div>
                    )}
                    {olderEntry !== null && (
                        <div>
                            <dt>Older entry used</dt>
                            <dd>
                                {filled.slice(0, 4).map(nutrientName).join(', ')}{filled.length > 4 ? ` and ${filled.length - 4} more` : ''}: from{' '}
                                <IntentLink href={`/food/${olderEntry}`}>USDA&apos;s older entry for this food</IntentLink>,
                                because this record has no value for {filled.length === 1 ? 'it' : 'them'}. Values measured in this record are never replaced.
                            </dd>
                        </div>
                    )}
                    {related.equivalents.length > 0 && (
                        <div>
                            <dt>Same food elsewhere</dt>
                            <dd>
                                {related.equivalents.map((f, i) => (
                                    <span key={f.id}>{i > 0 && ', '}<IntentLink href={foodPath(f)}>{dataSourceLabel(f.data_type) ?? f.description}</IntentLink></span>
                                ))}
                            </dd>
                        </div>
                    )}
                </dl>
                <p className="tiny muted">Values are per 100 g of edible portion, scaled to the serving you choose. USDA data is public domain. For general information, not medical advice.</p>
            </section>
        </main>
    );
}
