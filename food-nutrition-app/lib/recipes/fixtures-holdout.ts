/**
 * Held-out evaluation set. Written after the matcher's aliases and scoring were
 * frozen against lib/recipes/fixtures.ts, and deliberately not tuned against:
 * the first-run scores (docs/RECIPES.md) estimate accuracy on recipes the matcher
 * had not seen. Do not add aliases to fix a miss here without moving that recipe
 * to the tuning set and writing a new held-out one; a general bug it exposes
 * (a parser fix, say) is fine to fix, but the first-run scores stay as recorded.
 */
import type { FixtureRecipe } from './fixtures';

export const HOLDOUT_RECIPES: FixtureRecipe[] = [
    {
        title: 'Beef chili', servings: 6, kcalPerServing: [250, 550],
        lines: [
            { line: '1 tbsp canola oil', name: /canola oil/, food: /^oil, canola/i, grams: [12, 15] },
            { line: '1 1/2 lb lean ground beef', name: /beef/, food: /^beef, ground/i, grams: [675, 685] },
            { line: '1 large yellow onion, diced', name: /onion/, food: /^onions.*(yellow|raw)/i, grams: [110, 210] },
            { line: '1 green bell pepper, chopped', name: /bell pepper/, food: /^peppers?.*(bell|sweet).*green.*raw|^peppers?, bell, green/i, grams: [70, 180] },
            { line: '4 garlic cloves, minced', name: /garlic/, food: /^garlic, raw/i, grams: [10, 14] },
            { line: '2 tbsp chili powder', name: /chili powder/, food: /chili powder/i, grams: [12, 20] },
            { line: '1 tsp smoked paprika', name: /paprika/, food: /paprika/i, grams: [1.5, 3.5] },
            { line: '1 (15 oz) can kidney beans, drained', name: /kidney beans/, food: /^beans, kidney.*canned/i, grams: [420, 430] },
            { line: '1 (28 oz) can diced tomatoes', name: /tomatoes/, food: /tomato.*(canned|diced)/i, grams: [790, 800] },
            { line: '1 cup beef broth', name: /beef broth/, food: /beef.*(broth|stock)|(broth|stock).*beef/i, grams: [220, 250] },
        ],
    },
    {
        title: 'Thai green curry', servings: 4, kcalPerServing: [300, 700],
        lines: [
            { line: '1 tbsp coconut oil', name: /coconut oil/, food: /^oil, coconut/i, grams: [12, 15] },
            { line: '1 lb chicken thighs, boneless and skinless', name: /chicken thighs/, food: /^chicken.*thigh.*raw/i, grams: [450, 456] },
            { line: '3 tbsp green curry paste', name: /curry paste/, food: /curry/i, grams: [30, 60] },
            { line: '1 (13.5 oz) can coconut milk', name: /coconut milk/, food: /coconut milk/i, grams: [380, 385] },
            { line: '1 tbsp fish sauce', name: /fish sauce/, food: /fish.*sauce|sauce, fish/i, grams: [14, 20] },
            { line: '1 tbsp brown sugar', name: /brown sugar/, food: /sugars?, brown/i, grams: [9, 15] },
            { line: '1 cup bamboo shoots', name: /bamboo/, food: /bamboo shoots/i, grams: [110, 160] },
            { line: '1/2 cup fresh basil leaves', name: /basil/, food: /^basil, fresh/i, grams: [8, 15] },
            { line: '2 cups cooked jasmine rice', name: /rice/, food: /^rice.*cooked/i, grams: [300, 420] },
        ],
    },
    {
        title: 'Blueberry muffins', servings: 12, kcalPerServing: [150, 330],
        lines: [
            { line: '2 cups all purpose flour', name: /flour/, food: /flour.*all-purpose/i, grams: [240, 270] },
            { line: '2 tsp baking powder', name: /baking powder/, food: /baking powder/i, grams: [7, 11] },
            { line: '1/2 tsp kosher salt', name: /salt/, food: /^salt, table/i, grams: [2, 3.5] },
            { line: '1/2 cup unsalted butter, at room temperature', name: /butter/, food: /^butter.*unsalted/i, grams: [105, 120] },
            { line: '1 cup caster sugar', name: /sugar/, food: /sugars?, granulated/i, grams: [180, 210] },
            { line: '2 eggs', name: /eggs/, food: /egg.*whole/i, grams: [90, 112] },
            { line: '1/2 cup buttermilk', name: /buttermilk/, food: /buttermilk/i, grams: [115, 130] },
            { line: '1 1/2 cups fresh blueberries', name: /blueberries/, food: /^blueberries/i, grams: [200, 240] },
        ],
    },
    {
        title: 'Shakshuka', servings: 4, kcalPerServing: [120, 350],
        lines: [
            { line: '2 tablespoons extra-virgin olive oil', name: /olive oil/, food: /^oil, olive/i, grams: [25, 30] },
            { line: '1 onion, thinly sliced', name: /onion/, food: /^onions.*raw/i, grams: [90, 150] },
            { line: '1 red bell pepper, seeded and sliced', name: /bell pepper/, food: /^peppers?.*(bell|sweet).*red.*raw|^peppers?, bell, red/i, grams: [70, 180] },
            { line: '3 garlic cloves, sliced', name: /garlic/, food: /^garlic, raw/i, grams: [7, 12] },
            { line: '1 tsp ground cumin', name: /cumin/, food: /cumin/i, grams: [1.5, 3] },
            { line: '1 tsp sweet paprika', name: /paprika/, food: /paprika/i, grams: [1.5, 3.5] },
            { line: '1 (28-ounce) can whole tomatoes', name: /tomatoes/, food: /tomato.*canned/i, grams: [790, 800] },
            { line: '6 large eggs', name: /eggs/, food: /egg.*whole/i, grams: [280, 320] },
            { line: '1/2 cup crumbled feta', name: /feta/, food: /^cheese, feta/i, grams: [65, 85] },
        ],
    },
    {
        title: 'Caesar salad', servings: 4, kcalPerServing: [180, 480],
        lines: [
            { line: '2 heads romaine lettuce, chopped', name: /lettuce/, food: /^lettuce.*(romaine|cos)/i, grams: [500, 1300] },
            { line: '1/2 cup mayonnaise', name: /mayonnaise/, food: /mayonnaise/i, grams: [100, 125] },
            { line: '2 tbsp fresh lemon juice', name: /lemon juice/, food: /^lemon juice, raw/i, grams: [25, 35] },
            { line: '1 tsp Dijon mustard', name: /mustard/i, food: /mustard/i, grams: [3, 7] },
            { line: '2 anchovy fillets', name: /anchovy/, food: /anchov/i, grams: [5, 15] },
            { line: '1/2 cup grated Parmesan cheese', name: /parmesan/i, food: /^cheese, parmesan/i, grams: [40, 65] },
            { line: '2 cups croutons', name: /croutons/, food: /croutons/i, grams: [50, 90] },
        ],
    },
    {
        title: 'Peanut butter smoothie', servings: 2, kcalPerServing: [200, 450],
        lines: [
            { line: '2 frozen bananas', name: /bananas/, food: /^bananas?/i, grams: [200, 260] },
            { line: '2 tbsp creamy peanut butter', name: /peanut butter/, food: /^peanut butter/i, grams: [28, 36] },
            { line: '1 cup skim milk', name: /milk/, food: /^milk, nonfat/i, grams: [240, 250] },
            { line: '1 tbsp maple syrup', name: /maple syrup/, food: /syrups?, maple/i, grams: [18, 22] },
            { line: '1/2 tsp ground cinnamon', name: /cinnamon/, food: /cinnamon, ground/i, grams: [1, 2] },
        ],
    },
    {
        title: 'Mashed potatoes', servings: 6, kcalPerServing: [150, 350],
        lines: [
            { line: '3 pounds russet potatoes, peeled', name: /potatoes/, food: /^potatoes.*(russet|raw)/i, grams: [1355, 1365] },
            { line: '6 tablespoons butter', name: /butter/, food: /^butter.*salted/i, grams: [80, 90] },
            { line: '3/4 cup whole milk', name: /milk/, food: /^milk, whole/i, grams: [175, 195] },
            { line: '1/4 cup sour cream', name: /sour cream/, food: /^cream, sour|sour cream/i, grams: [50, 70] },
            { line: 'Kosher salt, to taste', name: /salt/i, food: /^salt, table/i, grams: null },
        ],
    },
    {
        title: 'Tuna pasta bake', servings: 4, kcalPerServing: [350, 800],
        lines: [
            { line: '300g penne', name: /penne/, food: /^pasta.*dry|^(spaghetti|macaroni).*dry/i, grams: [299, 301] },
            { line: '2 x 145g tins of tuna in water, drained', name: /tuna/, food: /tuna.*(water|light)/i, grams: [280, 300] },
            { line: '400ml passata', name: /passata/, food: /tomato/i, grams: [380, 430] },
            { line: '150g frozen peas', name: /peas/, food: /^peas/i, grams: [149, 151] },
            { line: '100g mature cheddar, grated', name: /cheddar/, food: /^cheese, cheddar/i, grams: [99, 101] },
            { line: '1 tbsp sunflower oil', name: /sunflower oil/, food: /^oil, sunflower/i, grams: [12, 15] },
        ],
    },
];
