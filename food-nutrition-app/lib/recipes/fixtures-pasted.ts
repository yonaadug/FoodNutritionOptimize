/**
 * Whole pasted recipes, as people paste them: titles, stories, headers, steps,
 * and the messy cases (prose, name-first metric lists, OCR slips, other
 * languages). Used to decide when the built-in reader can be trusted without AI
 * (lib/recipes/confidence.ts). Ingredient facts only, written for this file.
 *
 * `expect` lists what a careful reader should find. A row the built-in reader
 * misses counts as wrong on food and grams. `aiExpected` records which way the
 * routing rule should send the recipe; the evaluation reports both directions.
 */
export interface PastedExpect {
    name: RegExp;
    food: RegExp;
    grams: [number, number] | null;
}

export interface PastedRecipe {
    title: string;
    servings: number;
    kcalPerServing: [number, number];
    /** True when the built-in reader is expected to get this wrong (so it should go to AI). */
    messy: boolean;
    text: string;
    expect: PastedExpect[];
}

export const PASTED_RECIPES: PastedRecipe[] = [
    {
        title: 'Guacamole', servings: 4, kcalPerServing: [150, 320], messy: false,
        text: `Guacamole
Serves 4

Ingredients
3 ripe avocados
1 lime, juiced
1/2 tsp salt
1/2 cup diced onion
2 roma tomatoes, diced
1 clove garlic, minced
2 tbsp chopped cilantro

Instructions
1. Mash the avocados with the lime juice and salt.
2. Fold in the onion, tomatoes, garlic and cilantro. Serve right away.`,
        expect: [
            { name: /avocado/, food: /^avocados?, raw/i, grams: [400, 620] },
            { name: /lime/, food: /^limes?, raw|^lime juice/i, grams: [30, 70] },
            { name: /salt/, food: /^salt, table/i, grams: [2.5, 3.5] },
            { name: /onion/, food: /^onions.*raw/i, grams: [70, 90] },
            { name: /tomato/, food: /^tomato/i, grams: [100, 260] },
            { name: /garlic/, food: /^garlic, raw/i, grams: [2.5, 4] },
            { name: /cilantro/, food: /^coriander/i, grams: [1.5, 4] },
        ],
    },
    {
        title: 'Scrambled eggs on toast', servings: 2, kcalPerServing: [250, 480], messy: false,
        text: `Scrambled eggs on toast (serves 2)
4 large eggs
2 tbsp whole milk
1 tbsp butter
2 slices whole wheat bread
a pinch of salt
Whisk the eggs and milk. Melt the butter over low heat, add the eggs and stir gently until just set. Serve on the toast.`,
        expect: [
            { name: /eggs/, food: /egg.*whole/i, grams: [190, 220] },
            { name: /milk/, food: /^milk, whole/i, grams: [28, 33] },
            { name: /butter/, food: /^butter/i, grams: [12, 16] },
            { name: /bread/, food: /bread.*whole.?wheat|whole.?wheat.*bread/i, grams: [50, 90] },
            { name: /salt/, food: /^salt, table/i, grams: [0.2, 0.6] },
        ],
    },
    {
        title: 'Tuna salad', servings: 2, kcalPerServing: [200, 450], messy: false,
        text: `TUNA SALAD
Yield: 2 servings

INGREDIENTS
2 (5 oz) cans tuna, drained
3 tbsp mayonnaise
1 stalk celery, diced
1 tbsp lemon juice
1/4 tsp black pepper

DIRECTIONS
Mix everything in a bowl and chill.`,
        expect: [
            { name: /tuna/, food: /tuna.*canned|canned.*tuna/i, grams: [280, 285] },
            { name: /mayonnaise/, food: /mayonnaise/i, grams: [38, 48] },
            { name: /celery/, food: /^celery, raw/i, grams: [30, 70] },
            { name: /lemon juice/, food: /^lemon juice/i, grams: [13, 17] },
            { name: /pepper/, food: /^spices, pepper, black/i, grams: [0.4, 1] },
        ],
    },
    {
        title: 'Peanut butter banana smoothie', servings: 1, kcalPerServing: [330, 650], messy: false,
        text: `Peanut butter banana smoothie
Makes 1 serving
- 1 banana
- 1 cup milk
- 2 tbsp peanut butter
- 1 tsp honey
Blend until smooth.`,
        expect: [
            { name: /banana/, food: /^bananas?, .*raw|^bananas?, ripe/i, grams: [100, 135] },
            { name: /milk/, food: /^milk, whole/i, grams: [235, 250] },
            { name: /peanut butter/, food: /peanut butter/i, grams: [30, 34] },
            { name: /honey/, food: /^honey/i, grams: [6, 8] },
        ],
    },
    {
        title: 'Quinoa salad', servings: 4, kcalPerServing: [250, 480], messy: false,
        text: `Lemony quinoa salad

Prep time: 15 minutes
Serves: 4

Ingredients:
1 cup quinoa, rinsed
2 cups water
1 cucumber, diced
1 cup cherry tomatoes, halved
1/4 cup olive oil
2 tbsp lemon juice
1/2 cup crumbled feta

Method:
Simmer the quinoa in the water for 15 minutes, then cool. Toss with everything else.`,
        expect: [
            { name: /quinoa/, food: /^quinoa, uncooked/i, grams: [165, 175] },
            { name: /water/, food: /^(beverages, )?water/i, grams: [470, 480] },
            { name: /cucumber/, food: /^cucumber/i, grams: [150, 350] },
            { name: /tomatoes/, food: /^tomato/i, grams: [140, 160] },
            { name: /olive oil/, food: /^oil, olive/i, grams: [50, 56] },
            { name: /lemon juice/, food: /^lemon juice/i, grams: [27, 33] },
            { name: /feta/, food: /^cheese, feta/i, grams: [70, 80] },
        ],
    },
    {
        title: 'Porridge with raspberries', servings: 2, kcalPerServing: [250, 450], messy: false,
        text: `Porridge with raspberries
Serves 2
80 g rolled oats
500 ml milk
1 tbsp maple syrup
100 g raspberries`,
        expect: [
            { name: /oats/, food: /^oats/i, grams: [80, 80] },
            { name: /milk/, food: /^milk/i, grams: [500, 530] },
            { name: /maple/, food: /maple/i, grams: [18, 22] },
            { name: /raspberries/, food: /^raspberries/i, grams: [100, 100] },
        ],
    },
    {
        title: 'Baked salmon', servings: 4, kcalPerServing: [280, 520], messy: false,
        text: `Easy Baked Salmon

This is the salmon I make every week. It's quick, it's healthy, and my kids actually eat it. You can swap the dill for parsley if that's what you have.

Jump to Recipe

Ingredients
▢ 4 salmon fillets (6 oz each)
▢ 2 tbsp olive oil
▢ 2 cloves garlic, minced
▢ 1 lemon, sliced
▢ 1 tsp dried dill
▢ Salt and pepper to taste

Instructions
1. Heat the oven to 400°F.
2. Put the salmon on a lined tray, brush with the oil and garlic, top with lemon and dill.
3. Bake 12 to 15 minutes.`,
        expect: [
            { name: /salmon/, food: /^fish, salmon.*raw/i, grams: [650, 700] },
            { name: /olive oil/, food: /^oil, olive/i, grams: [25, 30] },
            { name: /garlic/, food: /^garlic, raw/i, grams: [5, 8] },
            { name: /lemon/, food: /^lemons?, raw/i, grams: [50, 120] },
            { name: /dill/, food: /dill/i, grams: [0.5, 2] },
            { name: /salt/i, food: /^salt, table/i, grams: null },
        ],
    },
    {
        title: 'Lemon garlic pasta', servings: 2, kcalPerServing: [450, 800], messy: false,
        text: `Lemon garlic pasta
8 oz spaghetti
2 tbsp butter
3 cloves garlic, minced
1 lemon, zested and juiced
1/4 cup grated parmesan
Boil the pasta in salted water until al dente.
Melt the butter and cook the garlic for a minute.
Toss everything together and serve.`,
        expect: [
            { name: /spaghetti/, food: /(pasta|spaghetti).*dry/i, grams: [225, 228] },
            { name: /butter/, food: /^butter/i, grams: [26, 30] },
            { name: /garlic/, food: /^garlic, raw/i, grams: [7, 12] },
            { name: /lemon/, food: /^lemons?, raw/i, grams: [50, 120] },
            { name: /parmesan/, food: /^cheese, parmesan/i, grams: [15, 35] },
        ],
    },
    {
        title: 'Chicken noodle soup', servings: 6, kcalPerServing: [150, 350], messy: false,
        text: `Chicken Noodle Soup
Serves 6

Ingredients
1 tbsp olive oil
1 onion, diced
2 carrots, sliced
2 stalks celery, sliced
1 (32 oz) carton chicken broth
2 cups egg noodles
2 cups shredded cooked chicken
1 tsp dried thyme

Instructions
Soften the vegetables in the oil, add the broth and thyme and bring to a boil. Add the noodles and chicken and simmer 8 minutes.`,
        expect: [
            { name: /olive oil/, food: /^oil, olive/i, grams: [12, 15] },
            { name: /onion/, food: /^onions.*raw/i, grams: [90, 150] },
            { name: /carrots/, food: /^carrots.*raw/i, grams: [90, 140] },
            { name: /celery/, food: /^celery, raw/i, grams: [50, 130] },
            { name: /broth/, food: /chicken.*(broth|stock)|(broth|stock).*chicken/i, grams: [880, 1000] },
            { name: /noodles/, food: /noodles, egg/i, grams: [70, 340] },
            { name: /chicken/, food: /^chicken.*(cooked|roasted|stewed)/i, grams: [250, 300] },
            { name: /thyme/, food: /thyme/i, grams: [0.5, 1.5] },
        ],
    },
    {
        title: 'Basil pesto', servings: 8, kcalPerServing: [120, 260], messy: false,
        text: `Basil pesto
Makes about 1 cup (8 servings)

Ingredients
2 cups packed basil leaves
1/3 cup pine nuts
1/2 cup grated parmesan
1/2 cup extra virgin olive oil
2 cloves garlic
1/4 tsp salt`,
        expect: [
            { name: /basil/, food: /^basil, fresh/i, grams: [40, 100] },
            { name: /pine nuts/, food: /pine ?nuts/i, grams: [42, 48] },
            { name: /parmesan/, food: /^cheese, parmesan/i, grams: [40, 55] },
            { name: /olive oil/, food: /^oil, olive/i, grams: [105, 112] },
            { name: /garlic/, food: /^garlic, raw/i, grams: [5, 8] },
            { name: /salt/, food: /^salt, table/i, grams: [1.2, 1.8] },
        ],
    },
    {
        title: 'Apple crumble', servings: 6, kcalPerServing: [220, 450], messy: false,
        text: `Apple crumble
Serves 6

For the filling:
4 apples, peeled and sliced
2 tbsp sugar
1 tsp ground cinnamon

For the topping:
3/4 cup all-purpose flour
1/2 cup rolled oats
1/2 cup brown sugar
6 tbsp cold butter, cubed

Bake at 350°F for 40 minutes.`,
        expect: [
            { name: /apples/, food: /^apples?, .*raw/i, grams: [500, 900] },
            { name: /^sugar/, food: /sugars?, granulated/i, grams: [24, 26] },
            { name: /cinnamon/, food: /cinnamon/i, grams: [2, 3] },
            { name: /flour/, food: /flour.*all-purpose/i, grams: [90, 100] },
            { name: /oats/, food: /^oats/i, grams: [35, 50] },
            { name: /brown sugar/, food: /sugars?, brown/i, grams: [70, 115] },
            { name: /butter/, food: /^butter/i, grams: [80, 90] },
        ],
    },
    {
        title: 'Coconut chickpea curry', servings: 4, kcalPerServing: [250, 550], messy: false,
        text: `Coconut chickpea curry
Serves 4
1 tbsp vegetable oil
1 onion, chopped
2–3 cloves garlic, minced
1 tbsp curry powder
1 (15 oz) can chickpeas, drained
1 (13.5 oz) can coconut milk
1 (14.5 oz) can diced tomatoes
2 cups fresh spinach
1–2 tbsp lime juice`,
        expect: [
            { name: /vegetable oil/, food: /^(oil|vegetable oil)/i, grams: [12, 15] },
            { name: /onion/, food: /^onions.*raw/i, grams: [90, 150] },
            { name: /garlic/, food: /^garlic, raw/i, grams: [5, 10] },
            { name: /curry powder/, food: /curry/i, grams: [5, 8] },
            { name: /chickpeas/, food: /^chickpeas.*canned/i, grams: [420, 430] },
            { name: /coconut milk/, food: /coconut milk/i, grams: [380, 385] },
            { name: /tomatoes/, food: /tomato.*(canned|diced)/i, grams: [405, 415] },
            { name: /spinach/, food: /^spinach/i, grams: [50, 90] },
            { name: /lime juice/, food: /^lime juice/i, grams: [15, 35] },
        ],
    },
    // ---- messy: the built-in reader should not be trusted with these ----
    {
        title: 'Weeknight chicken and rice (prose)', servings: 2, kcalPerServing: [450, 900], messy: true,
        text: `Weeknight chicken and rice. For this you'll want two chicken breasts, about a cup of white rice, a head of broccoli and a splash of soy sauce. Cook the rice, fry the chicken in a tablespoon of oil, steam the broccoli, and toss it all with the soy sauce.`,
        expect: [
            { name: /chicken/, food: /^chicken.*breast.*raw/i, grams: [300, 700] },
            { name: /rice/, food: /^rice, white.*raw/i, grams: [180, 200] },
            { name: /broccoli/, food: /^broccoli, raw/i, grams: [250, 650] },
            { name: /soy sauce/, food: /^soy sauce/i, grams: [5, 20] },
            { name: /oil/, food: /^oil/i, grams: [13, 15] },
        ],
    },
    {
        title: 'Crepes (one line)', servings: 4, kcalPerServing: [150, 330], messy: true,
        text: `Crepes. Ingredients: 2 eggs, 1 cup milk, 1 cup flour, 1 tbsp sugar, 2 tbsp melted butter, pinch of salt. Whisk together and rest 30 minutes.`,
        expect: [
            { name: /eggs/, food: /egg.*whole/i, grams: [95, 110] },
            { name: /milk/, food: /^milk, whole/i, grams: [235, 250] },
            { name: /flour/, food: /flour.*all-purpose/i, grams: [115, 130] },
            { name: /sugar/, food: /sugars?, granulated/i, grams: [12, 13] },
            { name: /butter/, food: /^butter/i, grams: [26, 30] },
            { name: /salt/, food: /^salt, table/i, grams: [0.2, 0.6] },
        ],
    },
    {
        title: 'Victoria sponge (name first)', servings: 10, kcalPerServing: [250, 450], messy: true,
        text: `Victoria sponge
Serves 10
Self-raising flour 225 g
Caster sugar 225 g
Butter, softened 225 g
Eggs 4
Milk 2 tbsp
Strawberry jam 4 tbsp`,
        expect: [
            { name: /flour/i, food: /flour/i, grams: [225, 225] },
            { name: /sugar/i, food: /sugars?, granulated/i, grams: [225, 225] },
            { name: /butter/i, food: /^butter/i, grams: [225, 225] },
            { name: /eggs/i, food: /egg.*whole/i, grams: [190, 220] },
            { name: /milk/i, food: /^milk/i, grams: [28, 33] },
            { name: /jam/i, food: /jams?\b|preserves/i, grams: [70, 90] },
        ],
    },
    {
        title: 'Pancakes (OCR slips)', servings: 4, kcalPerServing: [200, 420], messy: true,
        text: `PANCAKES
Serves 4
l cup fl0ur
2 tbsp sugar
2 tsp baking p0wder
1/2 tsp sa1t
1 cup mi1k
1 egg
2 tbsp me1ted butter`,
        expect: [
            { name: /flour/, food: /flour.*all-purpose/i, grams: [115, 130] },
            { name: /sugar/, food: /sugars?, granulated/i, grams: [24, 26] },
            { name: /baking powder/, food: /baking powder/i, grams: [7, 10] },
            { name: /salt/, food: /^salt, table/i, grams: [2.5, 3.5] },
            { name: /milk/, food: /^milk, whole/i, grams: [235, 250] },
            { name: /egg/, food: /egg.*whole/i, grams: [44, 56] },
            { name: /butter/, food: /^butter/i, grams: [26, 30] },
        ],
    },
    {
        title: 'Pasta with tomato sauce (British kitchen units)', servings: 2, kcalPerServing: [400, 900], messy: true,
        text: `Quick tomato pasta
Serves 2
a knob of butter
2 glugs of olive oil
1 tin chopped tomatoes
a handful of basil
2 mugs of penne`,
        expect: [
            { name: /butter/, food: /^butter/i, grams: [10, 20] },
            { name: /olive oil/, food: /^oil, olive/i, grams: [20, 40] },
            { name: /tomatoes/, food: /tomato.*(canned|chopped|diced)/i, grams: [390, 410] },
            { name: /basil/, food: /^basil, fresh/i, grams: [5, 15] },
            { name: /penne/, food: /pasta.*dry/i, grams: [150, 250] },
        ],
    },
    {
        title: 'Shortbread (dotted table)', servings: 16, kcalPerServing: [100, 200], messy: true,
        text: `Shortbread
Makes 16
Flour ........ 2 cups
Butter ....... 1 cup
Sugar ........ 1/2 cup
Salt ......... 1/4 tsp`,
        expect: [
            { name: /flour/i, food: /flour.*all-purpose/i, grams: [240, 260] },
            { name: /butter/i, food: /^butter/i, grams: [220, 230] },
            { name: /sugar/i, food: /sugars?, granulated/i, grams: [95, 105] },
            { name: /salt/i, food: /^salt, table/i, grams: [1.2, 1.8] },
        ],
    },
    {
        title: 'Tortilla de patatas (Spanish)', servings: 4, kcalPerServing: [250, 500], messy: true,
        text: `Tortilla de patatas
Para 4 personas
4 patatas medianas
1 cebolla
6 huevos
1/2 taza de aceite de oliva
1 cucharadita de sal`,
        expect: [
            { name: /patata/i, food: /^potatoes.*raw/i, grams: [600, 900] },
            { name: /cebolla/i, food: /^onions.*raw/i, grams: [90, 150] },
            { name: /huevos/i, food: /egg.*whole/i, grams: [280, 330] },
            { name: /aceite/i, food: /^oil, olive/i, grams: [105, 112] },
            { name: /sal\b/i, food: /^salt, table/i, grams: [5, 7] },
        ],
    },
    {
        title: 'Bread dough (instructions only)', servings: 12, kcalPerServing: [100, 220], messy: true,
        text: `Simple bread
Mix 4 cups of bread flour with 2 tsp salt and 1 packet of instant yeast. Add 1 1/2 cups warm water and 2 tbsp olive oil and knead for 10 minutes. Let it rise for an hour, shape, and bake at 425°F for 30 minutes.`,
        expect: [
            { name: /flour/, food: /flour.*bread/i, grams: [480, 560] },
            { name: /salt/, food: /^salt, table/i, grams: [10, 13] },
            { name: /yeast/, food: /yeast/i, grams: [6, 8] },
            { name: /water/, food: /^(beverages, )?water/i, grams: [350, 360] },
            { name: /olive oil/, food: /^oil, olive/i, grams: [25, 30] },
        ],
    },
    {
        title: 'Blog page with cruft', servings: 12, kcalPerServing: [150, 330], messy: false,
        text: `Best Banana Muffins
★★★★★ 4.8 from 230 reviews
Print Recipe Pin Recipe
Servings 12
US Customary Metric
1x 2x 3x
Ingredients
3 ripe bananas, mashed
1/3 cup melted butter
1/2 cup sugar
1 egg
1 tsp baking soda
1 1/2 cups all-purpose flour
Instructions
Mix the wet ingredients, fold in the dry, bake 20 minutes at 350°F.`,
        expect: [
            { name: /bananas/, food: /^bananas?, .*raw|^bananas?, ripe/i, grams: [300, 400] },
            { name: /butter/, food: /^butter/i, grams: [70, 80] },
            { name: /sugar/, food: /sugars?, granulated/i, grams: [90, 105] },
            { name: /egg/, food: /egg.*whole/i, grams: [44, 56] },
            { name: /baking soda/, food: /baking soda/i, grams: [4, 6] },
            { name: /flour/, food: /flour.*all-purpose/i, grams: [170, 200] },
        ],
    },
];
