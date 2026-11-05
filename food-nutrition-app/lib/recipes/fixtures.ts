/**
 * Golden set for the analyzer: ingredient lists of common recipes (facts only,
 * no instructions from any source) with hand-labelled expectations.
 *
 * `food` must match the chosen USDA description. `grams` is an acceptable
 * [min, max] range, deliberately wide enough to allow for USDA's portion
 * differences; null means the row should not be counted ("to taste").
 */
export interface FixtureLine {
    line: string;
    name: RegExp;
    food: RegExp;
    grams: [number, number] | null;
}

export interface FixtureRecipe {
    title: string;
    servings: number;
    /** Sanity range for calories per serving. */
    kcalPerServing: [number, number];
    lines: FixtureLine[];
}

export const FIXTURE_RECIPES: FixtureRecipe[] = [
    {
        title: 'Classic pancakes', servings: 4, kcalPerServing: [250, 450],
        lines: [
            { line: '1 1/2 cups all-purpose flour', name: /flour/, food: /flour.*all-purpose/i, grams: [170, 200] },
            { line: '3 1/2 tsp baking powder', name: /baking powder/, food: /baking powder/i, grams: [12, 20] },
            { line: '1 tbsp white sugar', name: /sugar/, food: /sugars?, granulated/i, grams: [10, 15] },
            { line: '1/4 tsp salt', name: /salt/, food: /^salt, table/i, grams: [1, 2] },
            { line: '1 1/4 cups milk', name: /milk/, food: /^milk, whole/i, grams: [290, 320] },
            { line: '1 egg', name: /egg/, food: /egg.*whole/i, grams: [44, 56] },
            { line: '3 tbsp butter, melted', name: /butter/, food: /^butter.*salted/i, grams: [38, 46] },
        ],
    },
    {
        title: 'Chocolate chip cookies', servings: 24, kcalPerServing: [130, 260],
        lines: [
            { line: '2 1/4 cups all-purpose flour', name: /flour/, food: /flour.*all-purpose/i, grams: [270, 295] },
            { line: '1 tsp baking soda', name: /baking soda/, food: /baking soda/i, grams: [4, 6] },
            { line: '1 tsp salt', name: /salt/, food: /^salt, table/i, grams: [5, 7] },
            { line: '1 cup (2 sticks) unsalted butter, softened', name: /butter/, food: /^butter.*unsalted/i, grams: [215, 235] },
            { line: '3/4 cup granulated sugar', name: /sugar/, food: /sugars?, granulated/i, grams: [135, 160] },
            { line: '3/4 cup packed brown sugar', name: /brown sugar/, food: /sugars?, brown/i, grams: [100, 170] },
            { line: '1 tsp vanilla extract', name: /vanilla/, food: /^vanilla extract/i, grams: [3, 5] },
            { line: '2 large eggs', name: /eggs/, food: /egg.*whole/i, grams: [95, 110] },
            { line: '2 cups semisweet chocolate chips', name: /chocolate/, food: /semisweet chocolate|chocolate.*semisweet/i, grams: [300, 370] },
        ],
    },
    {
        title: 'Spaghetti bolognese', servings: 6, kcalPerServing: [350, 800],
        lines: [
            { line: '1 lb ground beef', name: /beef/, food: /^beef, ground/i, grams: [450, 456] },
            { line: '1 medium onion, chopped', name: /onion/, food: /^onions.*raw/i, grams: [90, 150] },
            { line: '3 cloves garlic, minced', name: /garlic/, food: /^garlic, raw/i, grams: [7, 12] },
            { line: '1 (28 oz) can crushed tomatoes', name: /tomatoes/, food: /tomato.*(crushed|canned)|canned.*tomato/i, grams: [780, 800] },
            { line: '2 tbsp tomato paste', name: /tomato paste/, food: /tomato.*paste/i, grams: [25, 40] },
            { line: '2 tbsp olive oil', name: /olive oil/, food: /^oil, olive/i, grams: [25, 30] },
            { line: '1 tsp dried oregano', name: /oregano/, food: /oregano/i, grams: [0.5, 3] },
            { line: '1 lb spaghetti', name: /spaghetti/, food: /(pasta|spaghetti).*dry/i, grams: [450, 456] },
            { line: 'Salt and pepper to taste', name: /salt/i, food: /^salt, table/i, grams: null },
            { line: '1/4 cup grated parmesan', name: /parmesan/, food: /^cheese, parmesan/i, grams: [15, 35] },
        ],
    },
    {
        title: 'Chicken stir fry with rice', servings: 4, kcalPerServing: [300, 650],
        lines: [
            { line: '1 lb boneless skinless chicken breast, cubed', name: /chicken breast/, food: /^chicken.*breast.*(raw)/i, grams: [450, 456] },
            { line: '2 tbsp vegetable oil', name: /vegetable oil/, food: /^(oil|vegetable oil)/i, grams: [24, 30] },
            { line: '2 cups broccoli florets', name: /broccoli/, food: /^broccoli, raw/i, grams: [130, 190] },
            { line: '1 red bell pepper, sliced', name: /bell pepper/, food: /^peppers?, .*(bell|sweet).*raw/i, grams: [70, 180] },
            { line: '2 medium carrots, sliced', name: /carrots/, food: /^carrots.*raw/i, grams: [90, 140] },
            { line: '3 cloves garlic, minced', name: /garlic/, food: /^garlic, raw/i, grams: [7, 12] },
            { line: '1 tbsp fresh ginger, grated', name: /ginger/, food: /^ginger root, raw/i, grams: [4, 12] },
            { line: '1/4 cup soy sauce', name: /soy sauce/, food: /^soy sauce/i, grams: [50, 80] },
            { line: '1 tbsp cornstarch', name: /cornstarch/, food: /^corn ?starch/i, grams: [6, 10] },
            { line: '4 cups cooked white rice', name: /rice/, food: /^rice, white.*cooked/i, grams: [600, 830] },
        ],
    },
    {
        title: 'Black bean tacos', servings: 4, kcalPerServing: [250, 650],
        lines: [
            { line: '2 (15 oz) cans black beans, drained and rinsed', name: /black beans/, food: /^beans, black, canned/i, grams: [840, 860] },
            { line: '1 tbsp olive oil', name: /olive oil/, food: /^oil, olive/i, grams: [12, 15] },
            { line: '1 tsp ground cumin', name: /cumin/, food: /cumin/i, grams: [1.5, 3] },
            { line: '1 tsp chili powder', name: /chili powder/, food: /chili powder/i, grams: [2, 4] },
            { line: '8 corn tortillas', name: /tortillas/, food: /tortillas?.*corn/i, grams: [150, 320] },
            { line: '1 avocado, sliced', name: /avocado/, food: /^avocados?, raw/i, grams: [130, 210] },
            { line: '1/2 cup shredded cheddar cheese', name: /cheddar/, food: /^cheese, cheddar/i, grams: [45, 70] },
            { line: '1/4 cup chopped cilantro', name: /cilantro/, food: /^coriander/i, grams: [3, 6] },
            { line: '1 lime, cut into wedges', name: /lime/, food: /^limes?, raw/i, grams: [40, 70] },
        ],
    },
    {
        title: 'Banana bread', servings: 10, kcalPerServing: [180, 340],
        lines: [
            { line: '3 ripe bananas, mashed', name: /bananas/, food: /^bananas?, .*raw|^bananas?, ripe/i, grams: [300, 400] },
            { line: '1/3 cup melted butter', name: /butter/, food: /^butter.*salted/i, grams: [70, 80] },
            { line: '3/4 cup sugar', name: /sugar/, food: /sugars?, granulated/i, grams: [135, 160] },
            { line: '1 egg, beaten', name: /egg/, food: /egg.*whole/i, grams: [44, 56] },
            { line: '1 tsp vanilla', name: /vanilla/, food: /^vanilla extract/i, grams: [3, 5] },
            { line: '1 tsp baking soda', name: /baking soda/, food: /baking soda/i, grams: [4, 6] },
            { line: '1 1/2 cups flour', name: /flour/, food: /flour.*all-purpose/i, grams: [170, 200] },
            { line: '1/2 cup chopped walnuts', name: /walnuts/, food: /walnuts/i, grams: [45, 70] },
        ],
    },
    {
        title: 'Lentil soup', servings: 6, kcalPerServing: [150, 400],
        lines: [
            { line: '1 tbsp olive oil', name: /olive oil/, food: /^oil, olive/i, grams: [12, 15] },
            { line: '1 onion, diced', name: /onion/, food: /^onions.*raw/i, grams: [90, 150] },
            { line: '2 carrots, diced', name: /carrots/, food: /^carrots.*raw/i, grams: [90, 140] },
            { line: '2 stalks celery, diced', name: /celery/, food: /^celery, raw/i, grams: [50, 130] },
            { line: '2 cloves garlic', name: /garlic/, food: /^garlic, raw/i, grams: [5, 8] },
            { line: '1 1/2 cups dried lentils, rinsed', name: /lentils/, food: /^lentils.*(raw|dry)/i, grams: [270, 320] },
            { line: '6 cups vegetable broth', name: /vegetable broth/, food: /(vegetable|veg).*(broth|stock)|(broth|stock).*vegetable/i, grams: [1300, 1500] },
            { line: '1 (14.5 oz) can diced tomatoes', name: /tomatoes/, food: /tomato.*(canned|diced)/i, grams: [405, 415] },
            { line: '1 tsp cumin', name: /cumin/, food: /cumin/i, grams: [1.5, 3] },
            { line: '2 cups fresh spinach', name: /spinach/, food: /^spinach/i, grams: [50, 90] },
        ],
    },
    {
        title: 'Greek salad', servings: 4, kcalPerServing: [120, 350],
        lines: [
            { line: '4 roma tomatoes, chopped', name: /tomatoes/, food: /^tomato/i, grams: [200, 520] },
            { line: '1 cucumber, sliced', name: /cucumber/, food: /^cucumber/i, grams: [150, 350] },
            { line: '1/2 red onion, thinly sliced', name: /red onion/, food: /^onions, red, raw/i, grams: [50, 110] },
            { line: '1/2 cup kalamata olives', name: /olives/, food: /olives/i, grams: [60, 90] },
            { line: '4 oz feta cheese, crumbled', name: /feta/, food: /^cheese, feta/i, grams: [112, 115] },
            { line: '3 tbsp extra virgin olive oil', name: /olive oil/, food: /^oil, olive/i, grams: [38, 44] },
            { line: '1 tbsp red wine vinegar', name: /vinegar/, food: /^vinegar, red wine/i, grams: [13, 17] },
        ],
    },
    {
        title: 'Overnight oats', servings: 1, kcalPerServing: [300, 650],
        lines: [
            { line: '1/2 cup rolled oats', name: /oats/, food: /^oats/i, grams: [35, 50] },
            { line: '1/2 cup almond milk', name: /almond milk/, food: /^almond milk/i, grams: [110, 130] },
            { line: '1/4 cup plain Greek yogurt', name: /yogurt/i, food: /^yogurt, greek, plain/i, grams: [55, 75] },
            { line: '1 tbsp chia seeds', name: /chia/, food: /chia/i, grams: [8, 14] },
            { line: '1 tbsp honey', name: /honey/, food: /^honey/i, grams: [18, 24] },
            { line: '1/2 cup blueberries', name: /blueberries/, food: /^blueberries/i, grams: [65, 90] },
        ],
    },
    {
        title: 'Roast salmon with potatoes', servings: 4, kcalPerServing: [350, 750],
        lines: [
            { line: '1 1/2 lbs salmon fillets', name: /salmon/, food: /^fish, salmon.*raw/i, grams: [675, 685] },
            { line: '1.5 kg potatoes, peeled and cubed', name: /potatoes/, food: /^potatoes.*raw/i, grams: [1495, 1505] },
            { line: '2 tablespoons olive oil', name: /olive oil/, food: /^oil, olive/i, grams: [25, 30] },
            { line: '1 lemon, juiced', name: /lemon/, food: /^lemon/i, grams: [40, 70] },
            { line: '2 tbsp chopped fresh parsley', name: /parsley/, food: /^parsley, fresh/i, grams: [5, 10] },
            { line: '1/2 tsp black pepper', name: /pepper/, food: /^spices, pepper, black/i, grams: [1, 2] },
        ],
    },
    {
        title: 'Vegetable omelet', servings: 1, kcalPerServing: [250, 550],
        lines: [
            { line: '3 eggs', name: /eggs/, food: /egg.*whole/i, grams: [140, 165] },
            { line: '1 tbsp butter', name: /butter/, food: /^butter.*salted/i, grams: [12, 16] },
            { line: '1/4 cup diced bell pepper', name: /bell pepper/, food: /^peppers?, .*(bell|sweet).*raw/i, grams: [20, 50] },
            { line: '1/2 cup sliced mushrooms', name: /mushrooms/, food: /^mushrooms.*(white|raw)/i, grams: [25, 50] },
            { line: '1 oz cheddar cheese', name: /cheddar/, food: /^cheese, cheddar/i, grams: [27, 30] },
            { line: 'a pinch of salt', name: /salt/, food: /^salt, table/i, grams: [0.2, 0.6] },
        ],
    },
    {
        title: 'Hummus', servings: 8, kcalPerServing: [80, 220],
        lines: [
            { line: '1 (15 oz) can chickpeas, drained', name: /chickpeas/, food: /^chickpeas.*canned/i, grams: [420, 430] },
            { line: '1/4 cup tahini', name: /tahini/, food: /tahini/i, grams: [50, 70] },
            { line: '3 tbsp lemon juice', name: /lemon juice/, food: /^lemon juice/i, grams: [40, 50] },
            { line: '1 clove garlic', name: /garlic/, food: /^garlic, raw/i, grams: [2.5, 4] },
            { line: '2 tbsp olive oil', name: /olive oil/, food: /^oil, olive/i, grams: [25, 30] },
            { line: '1/2 tsp salt', name: /salt/, food: /^salt, table/i, grams: [2.5, 3.5] },
            { line: '2 tbsp water', name: /water/, food: /^(beverages, )?water/i, grams: [28, 32] },
        ],
    },
];
