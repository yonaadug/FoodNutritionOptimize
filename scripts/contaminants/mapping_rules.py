"""
Curated rules that point many USDA foods at one contaminant profile.

This is what removes duplication: "Eggs, Grade A, Large, egg whole", "Egg, whole, raw,
fresh" and "Egg, whole, cooked, scrambled" all resolve to the single FDA Total Diet Study
food "Eggs, hard-boiled". Measurements live on the profile; foods only hold a pointer.

Rule semantics (see build_contaminants.py):
  * Rules are grouped by profile family (tds, pdp, fish, rice, microplastics). A food gets at
    most one profile per family: the FIRST matching rule wins, so order specific -> general.
  * Patterns are re.search()ed against the lowercase USDA description.
  * `exclude` vetoes that rule only. A later rule may still match.
  * NEVER_MATCH stops a family from claiming a food at all (organ meats, supplements, ...).

Match methods and what they promise:
  exact             the USDA food is the item the source measured (confidence >= 0.95)
  description_rule  same food in another variety, brand or preparation (0.6 - 0.9)
  category          a wider group represented by one measured member (0.4 - 0.6)
  manual            hand-assigned one-off (confidence stated on the rule)

Moisture: `moisture=True` allows a dry-matter correction, because a contaminant in dry rice is
not diluted until the rice absorbs water. See build_contaminants.moisture_factor.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Rule:
    profile: str
    pattern: str
    confidence: float = 0.8
    method: str = "description_rule"
    exclude: str | None = None
    moisture: bool = True
    caveat: str | None = None
    category: str | None = None
    # FNDDS foods are mixed dishes ("Rice, white, with chicken"). Plain-ingredient data would misstate
    # them, so rules skip FNDDS foods unless they name a dish TDS measured directly.
    mixed_ok: bool = False


def T(num: int, pattern: str, confidence: float = 0.8, **kw) -> Rule:
    return Rule(f"tds:{num}", pattern, confidence, **kw)


def P(code: str, pattern: str, confidence: float = 0.85, **kw) -> Rule:
    # PDP measures the raw commodity. Residues do not concentrate predictably on drying, and
    # cooked foods differ little in dry matter, so PDP rules never moisture-scale.
    kw.setdefault("moisture", False)
    return Rule(f"pdp:{code}", pattern, confidence, **kw)


def F(species: str, pattern: str, confidence: float = 0.9, **kw) -> Rule:
    return Rule(f"fish:{species}", pattern, confidence, **kw)


def R(key: str, pattern: str, confidence: float = 0.9, **kw) -> Rule:
    return Rule(f"rice:{key}", pattern, confidence, **kw)


def M(key: str, pattern: str, confidence: float = 0.6, **kw) -> Rule:
    kw.setdefault("moisture", False)
    return Rule(f"mp:{key}", pattern, confidence, **kw)


# Organ meats concentrate cadmium and mercury far above muscle meat, so muscle-meat data must not
# stand in for them. Extracts, oils and supplements are not comparable to the whole food either.
ORGANS = r"\b(liver|livers|kidneys?|heart|hearts|giblets?|gizzards?|tongue|brain|brains|tripe|sweetbreads?|lungs?|spleen|thymus|pancreas|chitterlings|feet|ears?|tail|tails|suet|tallow|skin only|cracklings|mechanically|separable fat|backfat|leaf fat|external fat|seam fat|fatback)\b"
MIXED = r"\b(with|and|sandwich|salad|soup|stew|casserole|pie|pot pie|dinner|entree|meal|sauce|gravy|burrito|taco|pizza|nachos?)\b"
DRIED = r"\b(dried|dehydrated|powder|powdered|flakes|freeze-dried|concentrate|granules|seasoning)\b"
NOT_PLAIN_VEG = r"\b(soup|souffle|salad|pickled|pudding|with|and|sauce|juice|flour|seeds?|chips?|baby|babyfood|leaves|greens|shoots|flowers)\b"

# Foods no family may claim: not food-like, or not comparable with any measured item.
NEVER_MATCH = {
    "tds": r"\b(infant|babyfood|baby food|toddler|nutritional supplement|protein supplement|supplement for|industrial|fish oil|cod liver)\b",
    "pdp": r"\b(infant|babyfood|baby food|toddler|supplement|industrial)\b",
    "fish": r"^oil\b|\bfish oil\b|\b(infant|babyfood)\b",
    "rice": r"\b(infant|babyfood)\b",
    "mp": r"\b(infant|babyfood|industrial|supplement)\b",
}

# --------------------------------------------------------------------------- #
# FDA Total Diet Study (first match wins, so specific rules come first)
# --------------------------------------------------------------------------- #
TDS_RULES: list[Rule] = [
    # --- Eggs: every whole-egg variety, size and cooking method shares TDS food 37 ------------
    T(37, r"^egg, whole, cooked, hard-boiled", 0.98, method="exact"),
    T(37, r"^eggs, grade a, large, egg whole", 0.92),
    T(37, r"^egg, whole, (raw|cooked)", 0.92),
    T(37, r"^eggs, scrambled, frozen mixture|^fast foods, egg, scrambled", 0.7),
    T(37, r"^egg, whole, dried", 0.7),
    T(37, r"^egg, (duck|goose|quail|turkey), whole", 0.65, caveat="Measured on chicken eggs, not on this species."),
    T(37, r"^(eggs?, (grade a, large, )?(egg )?(white|yolk))|^egg, (white|yolk)", 0.6,
      caveat="Measured on whole eggs. Elements are not spread evenly between white and yolk, so this is a rough estimate."),
    T(37, r"^egg substitute", 0.45, category="dairy",
      caveat="Based on whole eggs. Egg substitutes are mostly egg white with additives."),

    # --- Milk and dairy -----------------------------------------------------------------------
    T(1, r"^milk, whole, 3\.25% milkfat", 0.98, method="exact"),
    T(1, r"^milk, (whole|fluid, whole|producer)", 0.9),
    T(1, r"^milk, (canned, )?evaporated", 0.6, exclude=r"nonfat|fat free|skim"),
    T(1, r"^milk, dry, whole", 0.6),
    T(3, r"^milk, chocolate|^milk, lowfat, fluid, 1% milkfat, chocolate", 0.9),
    T(4, r"^milk, (nonfat|skim|fluid, nonfat)", 0.92),
    T(4, r"^milk, canned, evaporated, nonfat|^milk, dry, nonfat", 0.6),
    T(2, r"^milk, (reduced fat|lowfat|fluid, 1%|fluid, 2%)", 0.92),
    T(2, r"^milk, (buttermilk|goat|sheep|indian buffalo)|^buttermilk|^kefir", 0.55,
      caveat="Based on cow's reduced-fat milk."),
    T(394, r"^milk shakes|shake, fast food|^fast foods?, shake", 0.85),
    T(10, r"^cheese, (american|pasteurized process)|^cheese (food|spread|product)|^kraft (velveeta|cheez|free singles)|^cheese sauce", 0.8),
    T(12, r"^cheese, cheddar", 0.95, exclude=r"cheez|substitute|imitation"),
    T(236, r"^cheese, (swiss|gruyere)", 0.92),
    T(237, r"^cream cheese|^cheese, cream|^cheese, neufchatel", 0.92),
    T(391, r"^cheese, monterey", 0.92),
    T(392, r"^cheese, mozzarella", 0.92),
    T(332, r"^cheese, cottage|^cottage cheese", 0.9),
    T(12, r"^cheese, ", 0.5, method="category", exclude=r"substitute|imitation|goat",
      caveat="No measurement for this cheese, so cheddar stands in."),
    T(300, r"^sour cream|^cream, sour|^kraft breakstone", 0.9),
    T(167, r"^cream, fluid, half and half", 0.97, method="exact"),
    T(167, r"^cream, ", 0.65, exclude=r"substitute|sour"),
    T(168, r"^cream substitute", 0.85),
    T(286, r"^ice creams?, vanilla|^ice cream, vanilla", 0.95),
    T(393, r"^ice creams?, chocolate", 0.95),
    T(286, r"^ice creams?\b|^light ice cream|^fat free ice cream", 0.65),
    T(409, r"^yogurt, frozen|^frozen yogurts", 0.9),
    T(235, r"^yogurt, fruit", 0.92),
    T(521, r"^yogurt, vanilla", 0.92),
    T(521, r"^yogurt, (greek|plain)", 0.75),
    T(164, r"^butter, (salted|without salt|whipped|stick|light)", 0.95, category="fats|dairy"),
    T(162, r"^margarine", 0.85),
    T(166, r"^mayonnaise", 0.9),
    T(377, r"^salad dressing, italian", 0.92),
    T(516, r"^salad dressing, ranch.*(reduced|light|fat.free|low)", 0.9),
    T(517, r"^salad dressing, ranch", 0.92),
    T(378, r"^oil, olive", 0.95),
    T(379, r"^oil, (vegetable|soybean|corn|canola|sunflower|safflower|peanut|cottonseed|cooking and salad)|^vegetable oil", 0.82, exclude=r"industrial"),

    # --- Meat and poultry (muscle meat only: organ meats are vetoed by `exclude`) --------------
    T(13, r"^beef, (ground|grass-fed, ground)", 0.92, exclude=ORGANS),
    T(334, r"^beef, (top sirloin|short loin|loin|tenderloin|sirloin)", 0.92, exclude=ORGANS),
    T(334, r"^beef, ", 0.72, method="category", exclude=ORGANS + r"|\b(cured|corned|jerky|dried|sandwich steaks?|pastrami|luncheon)\b",
      caveat="A loin cut represents all beef cuts."),
    T(334, r"^veal, ", 0.5, method="category", exclude=ORGANS, caveat="Based on beef. Veal was not measured."),
    T(239, r"^ham, (sliced|chopped|minced)|^luncheon meat, ham|^lunchmeat.*ham|^oscar mayer.*ham", 0.88),
    T(17, r"^(pork, cured, )?ham\b", 0.9, exclude=ORGANS + r"|\b(sliced|luncheon|salad|patties|spread|loaf|and cheese)\b"),
    T(20, r"^(pork, cured, )?bacon|^bacon\b", 0.9, category="pork|sausages", exclude=r"meatless|bits|turkey|and beef"),
    T(19, r"^sausage, (turkey|chicken|beef)|^sausage, breakfast sausage, beef", 0.55, method="category", exclude=r"meatless|vegetarian",
      caveat="Based on pork sausage. This meat was not measured."),
    T(19, r"^(pork )?sausage\b|^sausage, (pork|italian|breakfast)|^pork sausage", 0.85, exclude=r"meatless|vegetarian"),
    T(18, r"^pork, fresh, (loin|composite)", 0.9, exclude=ORGANS),
    T(18, r"^pork, ", 0.72, method="category", exclude=ORGANS + r"|\b(cured|bacon|ham)\b"),
    T(22, r"^lamb, (new zealand, )?(loin|rib|chop)|^lamb, (domestic|australian), (loin|rib)", 0.9, exclude=ORGANS),
    T(22, r"^lamb, ", 0.72, method="category", exclude=ORGANS),
    T(241, r"chicken nugget|mcnugget|chicken tender", 0.85, exclude=r"baby"),
    T(336, r"^(kfc|popeyes|fast foods?, chicken).*(breast|fried chicken)|^chicken, broilers.*breast.*(batter|flour)", 0.8),
    T(338, r"^(kfc|popeyes|fast foods?, chicken).*(drum|thigh|leg)", 0.8),
    T(240, r"^chicken, (broilers or fryers, )?breast|^chicken breast|^chicken, breast", 0.92, exclude=ORGANS),
    T(337, r"^chicken, .*(thigh|dark meat|leg|drumstick)", 0.85, exclude=ORGANS),
    T(240, r"^chicken, (broilers|roasting|stewing|cornish|capons)", 0.72, method="category", exclude=ORGANS),
    T(240, r"^chicken, (canned|ground)", 0.65, exclude=ORGANS + "|" + MIXED),
    T(390, r"^turkey, ground|^ground turkey", 0.92),
    T(543, r"^turkey.*(deli|sliced|luncheon)|^luncheon meat, turkey|^lunchmeat.*turkey", 0.85),
    T(26, r"^turkey.*breast", 0.92, exclude=ORGANS + r"|\b(deli|sliced)\b"),
    T(26, r"^turkey", 0.7, method="category", exclude=ORGANS + "|" + MIXED + r"|\b(deli|sliced|ham|bacon|sausage|pastrami|sticks|breaded)\b"),
    T(28, r"^frankfurter|^hot ?dog|^fast foods?, hot ?dog, plain", 0.88, exclude=r"meatless|chicken|turkey"),
    T(29, r"^bologna", 0.92),
    T(389, r"^salami", 0.92),

    # --- Fish and seafood (species measured by TDS only. Others get fish-table mercury only) ---
    T(34, r"^fish, fish sticks|fish sticks|^salmon nuggets", 0.88),
    T(340, r"^fish, tuna, light, canned|^tuna.*canned", 0.95),
    T(340, r"^fish, tuna, white, canned", 0.85),
    T(340, r"^fish, tuna(?!.*salad)|^tuna\b", 0.65, category="fish|finfish"),
    T(318, r"salmon", 0.88, category="finfish", exclude=r"nugget|smoked|cake|croquette"),
    T(339, r"^fish, catfish", 0.92),
    T(387, r"^(fish, )?cod\b", 0.9),
    T(388, r"^fish, tilapia", 0.95),
    T(244, r"^crustaceans, shrimp|^shrimp", 0.88, exclude=r"imitation|surimi|breaded"),

    # --- Legumes, nuts and seeds --------------------------------------------------------------
    T(47, r"^peanut butter", 0.95, exclude=r"cookie|cracker|sandwich"),
    T(48, r"^peanuts", 0.88),
    T(39, r"^beans, baked|^baked beans", 0.75),
    T(341, r"^refried beans|^beans, refried", 0.92),
    T(527, r"^beans, black\b|^beans, black turtle", 0.85),
    T(528, r"^beans, kidney", 0.88),
    T(529, r"^beans, pinto", 0.88),
    T(530, r"^beans, (white|navy|great northern|small white|cannellini)", 0.85),
    T(545, r"^chickpeas", 0.88),
    T(546, r"^lentils", 0.9),
    T(547, r"^tofu|^house foods.*tofu|^mori-nu", 0.85),
    T(506, r"^soymilk|^soy milk|^silk (plain|unsweetened|vanilla|very vanilla|light|chocolate)|^vitasoy", 0.85),
    T(544, r"^veggie burgers?|^vegetarian (fillets|meatloaf)|^meatless", 0.7),
    T(42, r"^lima beans", 0.85),
    T(46, r"^peas, green", 0.88),
    T(526, r"^nuts, almonds|^nuts, almond butter|^almond butter", 0.9),
    T(403, r"^nuts, walnuts", 0.92),
    T(414, r"^nuts, cashew", 0.9),
    T(343, r"^seeds, sunflower seed", 0.9),

    # --- Grains and pasta (rice has FDA inorganic arsenic too, see RICE_RULES) ------------------
    T(50, r"^rice, white|^white rice", 0.9, exclude=r"puffed|flour|bran"),
    T(402, r"^rice, brown|^brown rice", 0.9, exclude=r"puffed|flour|bran"),
    T(51, r"^cereals, oats|^oats|^oat bran", 0.82, exclude=r"flavored|apple|cinnamon|maple|instant, fortified, .*with"),
    T(52, r"^cereals, (cream of wheat|farina)|^farina", 0.9),
    T(53, r"^cereals, corn grits|^hominy", 0.85),
    T(58, r"^bread, white|^bread, italian|^bread, french", 0.88),
    T(62, r"^bread, (whole-wheat|wheat|whole wheat)", 0.88),
    T(63, r"^tortillas?, .*flour|^tortilla, flour", 0.9),
    T(400, r"^tortillas?, .*corn|^tortilla, corn", 0.9),
    T(60, r"^cornbread|^bread, cornbread", 0.85),
    T(65, r"^muffins?, blueberry", 0.92),
    T(66, r"^crackers?, saltines?", 0.92),
    T(251, r"^crackers?, graham|^cookies, graham", 0.92),
    T(252, r"^crackers?, (standard|butter|snack)", 0.75),
    T(531, r"^crackers?, cheese", 0.9),
    T(67, r"^snacks, tortilla chips", 0.92),
    T(138, r"^snacks, potato chips|^potato chips", 0.92),
    T(294, r"^snacks, pretzels", 0.92),
    T(372, r"^snacks, popcorn", 0.85),
    T(69, r"^noodles, egg", 0.92),
    T(347, r"^(spaghetti|pasta|macaroni), .*(cooked|enriched|dry)", 0.85, exclude=r"whole.wheat|with|mix|sauce|gluten|corn"),
    T(540, r"^(spaghetti|pasta|macaroni), .*whole.wheat", 0.88),
    T(539, r"^rice noodles", 0.9),
    T(522, r"^quinoa, (cooked|uncooked)", 0.9),
    T(71, r"^cereals ready-to-eat.*corn flakes", 0.9),
    T(74, r"^cereals ready-to-eat.*raisin bran", 0.9),
    T(75, r"^cereals ready-to-eat.*(crisp(y|ed)? rice|rice krispies)", 0.9),
    T(513, r"^cereals ready-to-eat.*honey.*(nut|oat)", 0.8),
    T(77, r"^cereals ready-to-eat.*(cheerios|oat rings?|toasted oat)", 0.82),
    T(514, r"^cereals ready-to-eat.*(shredded wheat|mini-wheats)", 0.85),
    T(512, r"granola(?!.*bar)", 0.8, exclude=r"bar"),
    T(523, r"granola bar|^snacks, granola bars", 0.85),
    T(515, r"^cereals, whole wheat", 0.85),
    T(249, r"^bagels?", 0.88),
    T(250, r"^english muffins?", 0.92),
    T(401, r"^rolls, (hamburger|hot ?dog)|^bread, roll", 0.85),
    T(399, r"^biscuits?\b", 0.82),
    T(344, r"^pancakes?\b", 0.85),
    T(345, r"^toaster pastries", 0.92),
    T(290, r"^doughnuts?, cake", 0.92),
    T(386, r"^sweet rolls, cinnamon|^cinnamon rolls?", 0.88),
    T(291, r"^brownies?", 0.92),
    T(183, r"^cookies?, chocolate chip", 0.92),
    T(184, r"^cookies?, (chocolate )?sandwich", 0.88),
    T(292, r"^cookies?, sugar", 0.92),
    T(178, r"^cake, chocolate", 0.88),
    T(369, r"^cake, (white|yellow)", 0.8),
    T(185, r"^pie, apple", 0.92),
    T(186, r"^pie, pumpkin", 0.92),
    T(541, r"^pie crust", 0.9),
    T(900, r"^wheat flour, white, all-purpose|^flour, wheat, all-purpose", 0.95),
    T(900, r"^wheat flours?, white|^flour, wheat", 0.82),
    T(903, r"^bread crumbs", 0.92),

    # --- Fruit ----------------------------------------------------------------------------------
    T(78, r"^apples?, raw, (red|with skin|fuji|gala|granny|honeycrisp|golden|red delicious)|^apples?, (fuji|gala|granny smith|honeycrisp|red delicious), with skin", 0.95),
    T(78, r"^apples?, ", 0.75, exclude=r"juice|sauce|pie"),
    T(84, r"^applesauce", 0.9),
    T(99, r"^apple juice", 0.92),
    T(79, r"^oranges?, raw|^oranges?, ", 0.9, exclude=r"juice|peel"),
    T(352, r"^orange juice", 0.9),
    T(80, r"^bananas?", 0.95, exclude=r"dehydrated|powder"),
    T(81, r"^watermelon", 0.95),
    T(83, r"^peaches?, ", 0.85, exclude=r"nectar|pie"),
    T(85, r"^pears?, ", 0.85, exclude=r"nectar|prickly"),
    T(86, r"^strawberries", 0.92, exclude=r"juice"),
    T(87, r"^fruit cocktail|^fruit salad", 0.85),
    T(88, r"^grapes", 0.92, exclude=r"juice|leaves"),
    T(257, r"^grape juice", 0.92),
    T(89, r"^melons, cantaloupe|^cantaloupe", 0.95),
    T(92, r"^grapefruit, ", 0.92, exclude=r"juice"),
    T(100, r"^grapefruit juice", 0.92),
    T(95, r"^raisins", 0.95),
    T(97, r"^avocados?", 0.95, exclude=r"oil"),
    T(396, r"^pineapple, ", 0.9, exclude=r"juice"),
    T(256, r"^pineapple juice", 0.92),
    T(398, r"^blueberries", 0.92, exclude=r"juice"),
    T(412, r"^mangos?, |^mangoes", 0.92, exclude=r"nectar"),
    T(351, r"^cranberry juice cocktail|^cranberry juice", 0.82),
    T(524, r"^lemon juice", 0.9),
    T(350, r"^fruit juice smoothie|^orange pineapple juice blend", 0.6),

    # --- Vegetables -----------------------------------------------------------------------------
    T(408, r"^spinach, (raw|mature)", 0.98, method="exact"),
    T(408, r"^spinach, ", 0.85, exclude=r"souffle"),
    T(108, r"^collards?", 0.9),
    T(109, r"^lettuce, (iceberg|cos or romaine)|^lettuce, iceberg", 0.85),
    T(357, r"^lettuce, ", 0.88),
    T(113, r"^broccoli, ", 0.9, exclude=r"raab|chinese"),
    T(114, r"^celery, ", 0.92, exclude=r"seed|flakes"),
    T(115, r"^asparagus, ", 0.92),
    T(116, r"^cauliflower, ", 0.92),
    T(117, r"^tomatoes?, (raw|red|ripe|grape|roma)", 0.92, exclude=r"juice|sauce|paste|puree"),
    T(519, r"^tomato (products|sauce)|^tomatoes?, .*(sauce|paste|puree)", 0.8),
    T(173, r"^ketchup|^catsup", 0.95),
    T(525, r"^tomato (and vegetable )?juice|^vegetable juice", 0.85),
    T(121, r"^beans, snap, .*(raw|fresh|frozen|cooked)", 0.88, exclude=r"canned"),
    T(122, r"^beans, snap, .*canned", 0.92),
    T(123, r"^cucumbers?", 0.92),
    T(125, r"^peppers?, (sweet|bell)", 0.88),
    T(126, r"^squash, winter", 0.92),
    T(407, r"^squash, (summer|zucchini)", 0.9),
    T(128, r"^onions?, ", 0.85, exclude=r"rings|powder|dehydrated|soup"),
    T(130, r"^mushrooms?, .*canned", 0.92),
    T(264, r"^mushrooms?, ", 0.85, exclude=r"canned|dried|powder|sauce|soup"),
    T(137, r"^potatoes?, baked", 0.92),
    T(258, r"french fr|^potatoes?, french", 0.88),
    T(136, r"^potatoes?, ", 0.82, exclude=r"chips|salad|flour|pancakes?|puffs|sticks|hash|dehydrated|au gratin|scalloped|mix|\bwith\b(?! salt)|mashed"),
    T(263, r"^brussels sprouts", 0.95),
    T(410, r"^eggplant", 0.92, exclude=r"pickled"),
    T(268, r"^vegetables, mixed", 0.9),
    T(356, r"^carrots?, ", 0.9, exclude=r"juice|dehydrated"),
    T(406, r"^cabbage, ", 0.88),
    T(411, r"^kale, ", 0.92, exclude=r"scotch"),
    T(413, r"^garlic, ", 0.92),
    T(397, r"^sweet potato(es)?, ", 0.92, exclude=r"leaves|puffs|canned"),
    T(54, r"^corn, sweet, .*(frozen|raw|cooked)", 0.85, exclude=r"canned"),
    T(55, r"^corn, sweet, .*canned", 0.92),
    T(161, r"^pickles?, ", 0.9, exclude=r"relish|sweet"),
    T(299, r"^olives", 0.92),
    T(359, r"^salsa|^sauce, salsa", 0.9),
    T(298, r"^mustard, prepared", 0.95),
    T(405, r"^sauce, barbecue", 0.92),
    T(518, r"^soy sauce", 0.92),
    T(520, r"^sauce, pasta|^sauce, (marinara|spaghetti)", 0.88),
    T(374, r"^gravy, .*(brown|beef)", 0.8),

    # --- Sweets -----------------------------------------------------------------------------------
    T(169, r"^sugars?, granulated", 0.97),
    T(170, r"^syrups?, (table blends|pancake)", 0.9),
    T(172, r"^honey", 0.98, category="sweets", method="exact"),
    T(910, r"^cocoa, dry powder", 0.95),
    T(910, r"^baking chocolate, unsweetened|^candies, .*dark chocolate|chocolate, dark, .*cacao", 0.4,
      caveat="Upper estimate from one cocoa powder sample. No dark chocolate was measured, and dark chocolate has less cocoa solids than cocoa powder."),
    T(371, r"^candies, .*(nougat|snickers|milky way|3 musketeers)", 0.8),
    T(187, r"^candies, .*milk chocolate|^candies, (hershey|m&m)", 0.82),
    T(295, r"^syrups?, chocolate", 0.92),
    T(293, r"^candies, hard", 0.92),
    T(511, r"^snacks, fruit leather|^candies, fruit snacks", 0.82),
    T(190, r"^gelatin desserts", 0.88),
    T(288, r"^frozen novelties, (ice type|fruit)|^popsicles?", 0.85),
    T(385, r"^sorbets?", 0.92),
    T(296, r"^jell(y|ies)|^jams and preserves", 0.82),
    T(542, r"^puddings?, chocolate", 0.85),

    # --- Beverages --------------------------------------------------------------------------------
    T(197, r"^beverages, tea, .*brewed|^tea, .*brewed", 0.92),
    T(305, r"^beverages, coffee, brewed|^coffee, brewed", 0.92),
    T(191, r"^beverages, carbonated, cola(?!.*(diet|sugar-free|low calorie))", 0.92),
    T(194, r"^beverages, carbonated, (cola.*(diet|sugar-free|low calorie)|low calorie, cola)", 0.92),
    T(508, r"^beverages, carbonated, (lemon-lime|sprite)", 0.92),
    T(198, r"^alcoholic beverage, beer", 0.95),
    T(200, r"^alcoholic beverage, (distilled, )?(whiskey|all \(gin)", 0.8),
    T(500, r"^alcoholic beverage, distilled, (vodka|gin|rum)", 0.85),
    T(501, r"^alcoholic beverage, wine, table, red", 0.95),
    T(502, r"^alcoholic beverage, wine, table, white", 0.95),
    T(503, r"^beverages, almond milk|^almond milk", 0.9),
    T(504, r"^nuts, coconut water", 0.9),
    T(505, r"^beverages, energy", 0.88),
    T(507, r"^beverages, sports|^sports drink", 0.88),
    T(380, r"^water, bottled|^beverages, water, bottled", 0.95),
    T(509, r"^beverages, .*(meal replacement|protein shake)", 0.65),
    T(510, r"protein powder|^beverages, .*protein powder|whey protein", 0.6, exclude=r"bar"),

    # --- Everything else ----------------------------------------------------------------------------
    T(904, r"^salt, (sea|table, sea)", 0.92),
    T(909, r"^salt, table", 0.95),
    T(902, r"^leavening agents, baking powder", 0.95),

    # --- Prepared dishes (only the ones TDS measured directly) -------------------------------------
    T(404, r"^pizza|digiorno pizza|pizza hut|cheese pizza", 0.65, category="pizza|fast foods|baked|restaurant", mixed_ok=True,
      caveat="Measured on fast-food cheese pizza. Toppings change the amounts."),
    T(146, r"^macaroni and cheese", 0.82, exclude=r"loaf|unprepared|uncooked|dry", mixed_ok=True),
    T(145, r"^chili (con carne )?with beans|^beans, chili", 0.82, mixed_ok=True),
    T(155, r"^soup, chicken noodle", 0.88, exclude=r"condensed(, commercial)?$|dry|dehydrated|unprepared|cubes", mixed_ok=True),
    T(156, r"^soup, tomato", 0.88, exclude=r"condensed(, commercial)?$|dry|dehydrated|unprepared|cubes", mixed_ok=True),
    T(533, r"^soup, (cream of )?broccoli", 0.82, exclude=r"condensed(, commercial)?$|dry|dehydrated|unprepared|cubes", mixed_ok=True),
    T(534, r"^soup, clam chowder, new england", 0.88, exclude=r"condensed(, commercial)?$|dry|dehydrated|unprepared|cubes", mixed_ok=True),
    T(535, r"^soup, cream of mushroom", 0.88, exclude=r"condensed(, commercial)?$|dry|dehydrated|unprepared|cubes", mixed_ok=True),
    T(536, r"^soup, cream of potato", 0.88, exclude=r"condensed(, commercial)?$|dry|dehydrated|unprepared|cubes", mixed_ok=True),
    T(537, r"^soup, vegetable beef|^soup, beef vegetable", 0.85, exclude=r"condensed(, commercial)?$|dry|dehydrated|unprepared|cubes", mixed_ok=True),
    T(538, r"^soup, vegetable", 0.82, exclude=r"condensed(, commercial)?$|dry|dehydrated|unprepared|cubes", mixed_ok=True),
    T(532, r"^soup, (chicken )?(broth|stock)|^soup, stock, chicken", 0.85, exclude=r"condensed(, commercial)?$|dry|dehydrated|unprepared|cubes", mixed_ok=True),
    T(367, r"^soup, ramen.*(water added|prepared)|ramen noodles?, .*prepared", 0.82, mixed_ok=True),
    T(152, r"^chicken pot ?pie|pot pie, chicken", 0.82, mixed_ok=True),
]

# Exact USDA description that represents each TDS food, used for dry-matter correction.
# A TDS food without an entry is never moisture-scaled.
TDS_MOISTURE_REFERENCE: dict[int, str] = {
    1: "Milk, whole, 3.25% milkfat, with added vitamin D",
    2: "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D",
    4: "Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)",
    13: "Beef, ground, 85% lean meat / 15% fat, patty, cooked, pan-broiled",
    18: "Pork, fresh, loin, center loin (chops), boneless, separable lean and fat, cooked, pan-broiled",
    22: "Lamb, loin, separable lean and fat, trimmed to 1/4\" fat, choice, cooked, broiled",
    26: "Turkey from whole, light meat, meat only, with added solution, cooked, roasted",
    37: "Egg, whole, cooked, hard-boiled",
    42: "Lima beans, immature seeds, frozen, baby, cooked, boiled, drained, without salt",
    46: "Peas, green, frozen, cooked, boiled, drained, without salt",
    50: "Rice, white, long-grain, regular, enriched, cooked",
    51: "Cereals, oats, regular and quick, unenriched, cooked with water (includes boiling and microwaving), without salt",
    69: "Noodles, egg, enriched, cooked",
    78: "Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)",
    83: "Peaches, yellow, raw",
    85: "Pears, raw",
    86: "Strawberries, raw",
    88: "Grapes, red or green (European type, such as Thompson seedless), raw",
    97: "Avocados, raw, all commercial varieties",
    108: "Collards, cooked, boiled, drained, without salt",
    113: "Broccoli, cooked, boiled, drained, without salt",
    115: "Asparagus, cooked, boiled, drained",
    116: "Cauliflower, cooked, boiled, drained, without salt",
    121: "Beans, snap, green, cooked, boiled, drained, without salt",
    125: "Peppers, sweet, green, raw",
    126: "Squash, winter, all varieties, cooked, baked, without salt",
    128: "Onions, raw",
    136: "Potatoes, boiled, cooked without skin, flesh, without salt",
    137: "Potatoes, baked, flesh and skin, without salt",
    240: "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
    244: "Crustaceans, shrimp, cooked",
    264: "Mushrooms, white, raw",
    318: "Fish, salmon, Atlantic, farmed, cooked, dry heat",
    334: "Beef, loin, top loin steak, boneless, lip-on, separable lean only, trimmed to 1/8\" fat, choice, cooked, grilled",
    339: "Fish, catfish, channel, farmed, cooked, dry heat",
    340: "Fish, tuna, light, canned in water, drained solids",
    347: "Pasta, cooked, enriched, without added salt",
    356: "Carrots, baby, raw",
    397: "Sweet potato, cooked, baked in skin, flesh, without salt",
    402: "Rice, brown, long-grain, cooked (Includes foods for USDA's Food Distribution Program)",
    406: "Cabbage, raw",
    407: "Squash, summer, zucchini, includes skin, cooked, boiled, drained, without salt",
    408: "Spinach, raw",
    411: "Kale, cooked, boiled, drained, without salt",
    527: "Beans, black, mature seeds, canned, low sodium",
    528: "Beans, kidney, red, mature seeds, canned, solids and liquids",
    529: "Beans, pinto, mature seeds, canned, solids and liquids",
    545: "Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, solids and liquids",
    546: "Lentils, mature seeds, cooked, boiled, without salt",
    539: "Rice noodles, cooked",
    540: "Pasta, whole-wheat, cooked (Includes foods for USDA's Food Distribution Program)",
    52: "Cereals, CREAM OF WHEAT, regular (10 minute), cooked with water, without salt",
    53: "Cereals, corn grits, white, regular and quick, enriched, cooked with water, without salt",
    515: "Cereals, whole wheat hot natural cereal, cooked with water, without salt",
    530: "Beans, white, mature seeds, canned",
    519: "Tomato products, canned, sauce",
    99: "Apple juice, canned or bottled, unsweetened, without added ascorbic acid",
    352: "Orange juice, canned, unsweetened",
    256: "Pineapple juice, canned or bottled, unsweetened, without added ascorbic acid",
    257: "Grape juice, canned or bottled, unsweetened, without added ascorbic acid",
    100: "Grapefruit juice, white, canned or bottled, unsweetened",
    522: "Quinoa, cooked",
}

# --------------------------------------------------------------------------- #
# USDA Pesticide Data Program (commodity level). Processed commodities come first.
# --------------------------------------------------------------------------- #
PDP_RULES: list[Rule] = [
    # Eggs, milk and other animal products
    P("EG", r"^eggs?, (whole|grade a, large, egg whole)", 0.92, exclude=DRIED),
    P("EG", r"^eggs?, (white|yolk|grade a, large, egg (white|yolk))", 0.6, exclude=DRIED,
      caveat="Measured on whole eggs, not on the white or yolk alone."),
    P("MK", r"^milk, (whole|reduced fat|lowfat|nonfat|fluid)", 0.92, exclude=r"chocolate"),
    P("BU", r"^butter, ", 0.9, category="fats|dairy"),
    P("CM", r"^cream, ", 0.8, exclude=r"substitute|sour"),
    P("FS", r"salmon", 0.85, category="finfish", exclude=r"nugget|smoked|cake"),
    P("HY", r"^honey", 0.95, category="sweets"),
    P("WB", r"^water, bottled|^beverages, water, bottled", 0.9),

    # Nuts, grains and legumes
    P("AL", r"^nuts, almonds", 0.9),
    P("PB", r"^peanut butter", 0.95, exclude=r"cookie|cracker|sandwich"),
    P("RI", r"^(rice|white rice|brown rice),? ", 0.85, category="cereal", exclude=r"bran|flour|noodles|wild"),
    P("OA", r"^(cereals, )?oats|^oat bran", 0.8),
    P("WF", r"^(wheat flours?|flour, wheat)", 0.9),
    P("CO", r"^corn (grain|flour)|^cornmeal", 0.75),
    P("SY", r"^soybeans?, (mature|grain)|^edamame", 0.65, exclude=r"oil"),
    P("ZB", r"^chickpeas.*canned", 0.92),
    P("ZD", r"^chickpeas", 0.88, exclude=r"canned|flour"),

    # Fruit: juices and processed forms first, then fresh
    P("AJ", r"^apple juice", 0.95),
    P("AC", r"^applesauce", 0.95),
    P("AP", r"^apples?, ", 0.92, exclude=DRIED + r"|juice|sauce|pie"),
    P("OJ", r"^orange juice", 0.92),
    P("OG", r"^oranges?, ", 0.92, exclude=r"juice|peel"),
    P("TA", r"^(tangerines|clementines|mandarin)", 0.92, exclude=r"juice"),
    P("GF", r"^grapefruit, ", 0.92, exclude=r"juice"),
    P("BN", r"^bananas?", 0.95, exclude=DRIED),
    P("WM", r"^watermelon", 0.95),
    P("CN", r"^melons, cantaloupe|^cantaloupe", 0.95),
    P("CC", r"^peaches?, canned", 0.92),
    P("HZ", r"^peaches?, frozen", 0.92),
    P("PC", r"^peaches?, ", 0.92, exclude=DRIED + r"|nectar|pie"),
    P("PE", r"^pears?, ", 0.92, exclude=DRIED + r"|nectar|prickly"),
    P("SZ", r"^strawberries, frozen", 0.95),
    P("ST", r"^strawberries", 0.95, exclude=DRIED + r"|juice"),
    P("GJ", r"^grape juice", 0.95),
    P("GR", r"^grapes", 0.95, exclude=r"juice|leaves"),
    P("RA", r"^raisins", 0.95),
    P("PD", r"^prunes|^plums, dried", 0.92),
    P("PU", r"^plums?, ", 0.92, exclude=DRIED),
    P("AV", r"^avocados?", 0.95, exclude=r"oil"),
    P("NC", r"^pineapple, canned", 0.92),
    P("NZ", r"^pineapple, frozen", 0.92),
    P("PN", r"^pineapple, ", 0.92, exclude=r"juice"),
    P("BZ", r"^blueberries, frozen", 0.95),
    P("BB", r"^blueberries", 0.95, exclude=DRIED + r"|juice"),
    P("KZ", r"^blackberries, frozen", 0.95),
    P("BK", r"^blackberries", 0.95, exclude=r"juice"),
    P("MA", r"^mangos?, |^mangoes", 0.92, exclude=DRIED + r"|nectar"),
    P("KW", r"^kiwifruit", 0.92),
    P("CZ", r"^cherries, .*frozen", 0.92),
    P("CH", r"^cherries, ", 0.88, exclude=r"canned|frozen"),
    P("RC", r"^cranberries, canned|^cranberry sauce", 0.88),
    P("AZ", r"^cranberries, frozen", 0.92),
    P("CA", r"^cranberries, ", 0.9, exclude=DRIED),

    # Vegetables: canned and frozen before fresh
    P("SC", r"^spinach, canned", 0.95),
    P("SF", r"^spinach, frozen", 0.95),
    P("SP", r"^spinach, ", 0.92, exclude=r"souffle"),
    P("GK", r"^kale, ", 0.92, exclude=r"scotch"),
    P("GL", r"^collards?", 0.92),
    P("MG", r"^mustard greens", 0.92),
    P("LH", r"^lettuce, iceberg", 0.95),
    P("LL", r"^lettuce, ", 0.9),
    P("BS", r"^basil|^spices, basil", 0.85, exclude=DRIED),
    P("CL", r"^coriander \(cilantro\) leaves", 0.92),
    P("BR", r"^broccoli, ", 0.92, exclude=r"raab|chinese"),
    P("CF", r"^cauliflower, ", 0.92),
    P("CG", r"^cabbage, ", 0.9),
    P("CE", r"^celery, ", 0.92, exclude=r"seed|flakes"),
    P("AS", r"^asparagus, ", 0.92),
    P("CR", r"^carrots?, ", 0.92, exclude=r"juice|dehydrated"),
    P("ON", r"^onions?, ", 0.88, exclude=r"rings|powder|dehydrated|soup|spring|scallion"),
    P("GO", r"^onions, (spring|scallion)|^green onion", 0.92),
    P("PO", r"^potatoes?, ", 0.88, exclude=DRIED + r"|chips|salad|pancakes?|puffs|sticks|french|au gratin|scalloped|mix|mashed"),
    P("SW", r"^sweet potato(es)?, ", 0.92, exclude=r"leaves|puffs"),
    P("RD", r"^radishes", 0.92, exclude=r"seed"),
    P("MU", r"^mushrooms?, ", 0.85, exclude=r"canned|dried|powder|sauce|soup"),
    P("CU", r"^cucumbers?", 0.92),
    P("PP", r"^peppers?, (sweet|bell)", 0.92),
    P("HP", r"^peppers?, (hot|chili|jalapeno|serrano|ancho|pasilla)", 0.88, exclude=DRIED),
    P("EP", r"^eggplant", 0.92, exclude=r"pickled"),
    P("SS", r"^squash, (summer|zucchini)", 0.92),
    P("WS", r"^squash, winter", 0.92),
    P("PK", r"^pumpkin, canned", 0.95),
    P("TC", r"^tomatoes?, .*canned|^tomato products, canned", 0.88, exclude=r"paste|sauce|puree"),
    P("TP", r"^tomato products, canned, paste|^tomatoes?, .*paste", 0.95),
    P("CT", r"^tomatoes?, .*(cherry|grape)", 0.92),
    P("TO", r"^tomatoes?, (raw|red|ripe|roma)", 0.92, exclude=r"juice|sauce|paste|puree|canned"),
    P("TT", r"^tomatillos", 0.95),
    P("GB", r"^beans, snap, .*(raw|fresh|frozen|cooked)", 0.88, exclude=r"canned"),
    P("SN", r"^peas, (edible-podded|snap)", 0.88),
    P("SD", r"^peas, green, canned", 0.95),
    P("PS", r"^peas, green, frozen", 0.95),
    P("CS", r"^corn, sweet, .*frozen", 0.95),
    P("CB", r"^corn, sweet, .*(raw|cooked)", 0.88, exclude=r"canned|frozen"),
    P("OL", r"^olives", 0.9),
]

# --------------------------------------------------------------------------- #
# FDA mercury in commercial fish and shellfish. Keys are species names from the FDA table.
# --------------------------------------------------------------------------- #
FISH_RULES: list[Rule] = [
    F("BASS CHILEAN", r"^sea bass, chilean", 0.95),
    F("TUNA (CANNED, LIGHT)", r"^fish, tuna, light, canned|^tuna, light", 0.95),
    F("TUNA (CANNED, ALBACORE)", r"^fish, tuna, white, canned", 0.95),
    F("TUNA (FRESH/FROZEN, YELLOWFIN)", r"^fish, tuna, (fresh, )?yellowfin|^tuna, ahi or yellowfin", 0.95),
    F("TUNA (FRESH/FROZEN, SKIPJACK)", r"^fish, tuna, (fresh, )?skipjack", 0.8, caveat="FDA tested only 3 skipjack samples."),
    F("TUNA (FRESH/FROZEN, ALL)", r"^fish, tuna, (fresh, )?bluefin|^fish, tuna, fresh|^tuna\b", 0.75),
    F("TUNA (CANNED, LIGHT)", r"^fish, tuna salad", 0.5, caveat="Tuna salad also contains non-fish ingredients, so this overstates mercury per gram."),
    F("SALMON (CANNED)", r"^fish, salmon, .*canned", 0.95),
    F("SALMON (FRESH/FROZEN)", r"^(fish, )?salmon", 0.92, category="finfish", exclude=r"nugget|cake"),
    F("SCALLOP", r"^mollusks, scallop|^scallops", 0.95, exclude=r"imitation|surimi"),
    F("CLAM", r"^mollusks, clam", 0.95),
    F("OYSTER", r"^mollusks, oyster", 0.95),
    F("SQUID", r"^mollusks, squid|^squid", 0.95),
    F("SHRIMP", r"^crustaceans, shrimp|^shrimp", 0.95, exclude=r"imitation|surimi"),
    F("CRAWFISH", r"^crustaceans, crayfish", 0.95),
    F("CRAB", r"^crustaceans, crab|^snow crab", 0.92, exclude=r"imitation|surimi|cakes"),
    F("LOBSTER (NORTHERN / AMERICAN)", r"^crustaceans, lobster|^lobster", 0.95),
    F("LOBSTER (Spiny)", r"^crustaceans, spiny lobster", 0.95),
    F("SARDINE", r"^fish, sardine", 0.95),
    F("ANCHOVIES", r"^(fish, )?anchov", 0.95),
    F("TILAPIA", r"^fish, tilapia", 0.95),
    F("CATFISH", r"^fish, catfish", 0.95),
    F("POLLOCK", r"^fish, pollock|^alaska pollock", 0.95),
    F("SHAD", r"^fish, shad", 0.95),
    F("MULLET", r"^fish, mullet", 0.95),
    F("WHITING", r"^fish, whiting", 0.95),
    F("HADDOCK (Atlantic)", r"^fish, haddock", 0.95),
    F("FLATFISH", r"^fish, flatfish|^fish, (flounder|sole)", 0.95),
    F("BUTTERFISH", r"^fish, butterfish", 0.9),
    F("CROAKER ATLANTIC (Atlantic)", r"^fish, croaker", 0.9),
    F("TROUT (FRESHWATER)", r"^fish, trout", 0.92),
    F("WEAKFISH (SEA TROUT)", r"^fish, seatrout", 0.92),
    F("HERRING", r"^fish, herring", 0.95),
    F("WHITEFISH", r"^fish, whitefish", 0.95),
    F("SHEEPSHEAD", r"^fish, sheepshead", 0.95),
    F("CARP", r"^fish, carp", 0.95),
    F("COD", r"^(fish, )?cod\b", 0.95),
    F("PERCH OCEAN", r"^fish, ocean perch", 0.95),
    F("PERCH (Freshwater)", r"^fish, perch", 0.92),
    F("TILEFISH (Atlantic)", r"^fish, tilefish", 0.85, caveat="Tilefish from the Gulf of Mexico has much more mercury. FDA lists it separately at about 1.1 ppm."),
    F("MONKFISH", r"^fish, monkfish", 0.95),
    F("SNAPPER", r"^(fish, )?snapper", 0.95),
    F("BASS (SALTWATER, BLACK, STRIPED, ROCKFISH)", r"^fish, bass, fresh ?water", 0.55,
      caveat="FDA lists saltwater bass only. Freshwater bass may differ a lot by lake or river."),
    F("BASS (SALTWATER, BLACK, STRIPED, ROCKFISH)", r"^fish, (bass|rockfish|sea bass)|^sea bass", 0.88),
    F("MAHI MAHI", r"^(fish, )?mahi ?mahi", 0.95),
    F("MACKEREL KING", r"^fish, mackerel, king", 0.95),
    F("MACKEREL SPANISH (S. Atlantic)", r"^fish, mackerel, spanish", 0.85, caveat="Spanish mackerel from the Gulf of Mexico has more mercury. FDA lists it separately at about 0.45 ppm."),
    F("MACKEREL CHUB (Pacific)", r"^fish, mackerel, (pacific|jack)", 0.85),
    F("MACKEREL ATLANTIC (N.Atlantic)", r"^fish, mackerel", 0.85),
    F("HALIBUT", r"^(fish, )?halibut", 0.92),
    F("SABLEFISH", r"^fish, sablefish", 0.95),
    F("BLUEFISH", r"^fish, bluefish", 0.95),
    F("GROUPER (ALL SPECIES)", r"^fish, grouper", 0.95),
    F("ORANGE ROUGHY", r"^fish, roughy", 0.95),
    F("SHARK", r"^fish, shark", 0.95),
    F("SWORDFISH", r"^(fish, )?swordfish", 0.95),
    F("HAKE", r"^fish, hake", 0.95),
    F("JACKSMELT", r"^fish, smelt", 0.7, caveat="Based on jacksmelt, a related fish."),
    F("POLLOCK", r"^fish, surimi", 0.6, caveat="Surimi is usually made from pollock."),
    F("POLLOCK", r"^fish, fish sticks", 0.65, caveat="Fish sticks are usually made from pollock or cod."),
]

# --------------------------------------------------------------------------- #
# FDA inorganic arsenic in rice. Values are for uncooked rice, so cooked rice is moisture-scaled.
# --------------------------------------------------------------------------- #
RICE_RULES: list[Rule] = [
    R("brown_basmati", r"^rice, brown.*basmati", 0.92),
    R("brown_regular", r"^rice, brown|^brown rice", 0.92, exclude=r"parboiled|instant|pre-cooked|puffed|flour|bran"),
    R("brown_parboiled", r"^rice, brown, parboiled", 0.8, caveat="FDA tested only 1 sample of this type."),
    R("white_basmati", r"^rice, white.*basmati|^rice, basmati", 0.92),
    R("white_jasmine", r"^rice, white.*jasmine|^rice, jasmine", 0.92),
    R("white_parboiled", r"^rice, white.*parboiled", 0.95),
    R("white_instant", r"^rice, white.*(instant|precooked|pre-cooked)", 0.95),
    R("white_medium", r"^rice, white, medium-grain", 0.95),
    R("white_short", r"^rice, white, short-grain", 0.95),
    R("white_long", r"^rice, white, long-grain", 0.95),
    R("white_long", r"^rice, white|^white rice", 0.75, exclude=r"glutinous|puffed|flour|bran",
      caveat="Long-grain white rice represents this rice type."),
    R("white_short", r"^rice, white, glutinous", 0.65, caveat="Glutinous rice was not listed. Short-grain white rice stands in."),
]

# USDA food representing FDA's uncooked rice samples, used to scale to cooked rice.
RICE_MOISTURE_REFERENCE: dict[str, str] = {
    "white": "Rice, white, long-grain, regular, raw, enriched",
    "brown": "Rice, brown, long-grain, raw (Includes foods for USDA's Food Distribution Program)",
}

# --------------------------------------------------------------------------- #
# Microplastics (published estimates, see data/contaminants/microplastics.tsv)
# --------------------------------------------------------------------------- #
MICROPLASTIC_RULES: list[Rule] = [
    M("salt", r"^salt, ", 0.7, category="spices"),
    M("sugar", r"^sugars?, granulated", 0.6),
    M("honey", r"^honey", 0.6, category="sweets"),
    M("beer", r"^alcoholic beverage, beer", 0.65),
    M("bottled_water", r"^water, bottled|^beverages, water, bottled", 0.6),
    M("tap_water", r"^water, tap|^beverages, water, tap", 0.65),
    M("breaded_shrimp", r"shrimp.*breaded", 0.8, exclude=r"imitation|surimi"),
    M("shrimp", r"^crustaceans, shrimp|^shrimp", 0.7, exclude=r"imitation|surimi"),
    M("fish_stick", r"fish sticks", 0.8),
    M("pollock", r"^fish, pollock|^alaska pollock", 0.75),
    M("chicken_nugget", r"chicken nugget|mcnugget|chicken tender", 0.75),
    M("plant_nugget", r"^vegetarian fillets|meatless.*nugget", 0.6),
    M("plant_ground", r"^veggie burgers?|^vegetarian meatloaf|^meatless", 0.5),
    M("tofu", r"^tofu|^house foods.*tofu|^mori-nu", 0.75),
    M("clam", r"^mollusks, clam", 0.7),
    M("mussel", r"^mollusks, mussel", 0.7),
    M("oyster", r"^mollusks, oyster", 0.7),
    M("scallop", r"^mollusks, scallop|^scallops", 0.7, exclude=r"imitation|surimi"),
    M("mollusk", r"^mollusks, |^squid", 0.55),
    # Small fish are eaten whole, gut included, which is what the whole-organism studies measured.
    M("seafood", r"anchov|^fish, (sardine|smelt)", 0.45, exclude=r"\boil\b"),
    # Fillets: Milne's pollock is the only edible-portion measurement of finfish in our sources. The
    # all-seafood average includes studies of fish guts, so it would overstate what people eat.
    M("pollock", r"^(fish, |tuna\b|salmon\b|cod\b|halibut\b|snapper\b|swordfish\b|sea bass\b|mahi mahi\b)", 0.35,
      exclude=r"\b(oil|salad|roe|caviar|surimi|gefiltefish)\b", category="finfish",
      caveat="Only Alaska pollock was measured, so it stands in for this fish. Studies of whole fish, often including the gut, found up to 2.9 particles per gram."),
    M("shrimp", r"^crustaceans, ", 0.4, exclude=r"imitation|surimi|cakes",
      caveat="Shrimp stands in for other crustaceans. Published studies range from 0.1 to 8.6 particles per gram, mostly on whole animals."),
    M("steak", r"^beef, (top sirloin|short loin|loin|sirloin)", 0.55, exclude=ORGANS),
    M("steak", r"^beef, ", 0.4, method="category", exclude=ORGANS, caveat="A top sirloin steak stands in for all beef."),
    M("pork", r"^pork, (fresh, )?(loin|chop|composite)", 0.55, exclude=ORGANS),
    M("pork", r"^pork, ", 0.4, method="category", exclude=ORGANS + r"|\b(cured|bacon|ham)\b", caveat="A pork loin chop stands in for all pork."),
    M("chicken", r"^chicken, (broilers or fryers, )?breast|^chicken breast", 0.55, exclude=ORGANS),
    M("chicken", r"^chicken, (broilers|roasting|stewing|cornish|capons)", 0.4, method="category", exclude=ORGANS,
      caveat="Chicken breast stands in for other cuts."),
]

ALL_RULES = {
    "tds": TDS_RULES,
    "pdp": PDP_RULES,
    "fish": FISH_RULES,
    "rice": RICE_RULES,
    "mp": MICROPLASTIC_RULES,
}


def compiled() -> dict[str, list[tuple[Rule, re.Pattern, re.Pattern | None, re.Pattern | None]]]:
    out = {}
    for family, rules in ALL_RULES.items():
        out[family] = [
            (r, re.compile(r.pattern), re.compile(r.exclude) if r.exclude else None,
             re.compile(r.category) if r.category else None)
            for r in rules
        ]
    return out
