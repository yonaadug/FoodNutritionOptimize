/**
 * Renders recipe cards for the model benchmark (lib/ai/eval/bench.ts) from the
 * fixture recipes' own lines: no downloaded photos and no personal data. Each
 * card is a 1568x1176 JPEG, the size the browser sends (lib/ai/image.ts
 * MAX_EDGE_PX), so image-token counts match production.
 *
 * Styles vary a little (paper colour, font, a slight tilt, a coffee ring, a
 * blurred variant) so the set isn't one clean template. They are still printed
 * cards: easier than a handwritten card or a phone photo of a cookbook page.
 */
import type { FixtureRecipe } from '../../recipes/fixtures';

export interface CardStyle {
    paper: string;
    ink: string;
    font: string;
    /** Degrees. */
    tilt: number;
    stain: boolean;
    /** Gaussian blur sigma; 0 for none. */
    blur: number;
    /** Two columns of ingredients instead of one. */
    columns: 1 | 2;
}

export const CARD_STYLES: CardStyle[] = [
    { paper: '#fffdf6', ink: '#1d1d1d', font: 'Georgia, serif', tilt: 0, stain: false, blur: 0, columns: 1 },
    { paper: '#f4ecd8', ink: '#2b2118', font: 'Helvetica, Arial, sans-serif', tilt: -2.5, stain: true, blur: 0, columns: 1 },
    { paper: '#ffffff', ink: '#14213d', font: 'Courier New, monospace', tilt: 1.5, stain: false, blur: 0.8, columns: 1 },
    { paper: '#eef6ee', ink: '#1b3a1b', font: 'Times New Roman, serif', tilt: 0, stain: false, blur: 0, columns: 2 },
];

export const CARD_WIDTH = 1568;
export const CARD_HEIGHT = 1176;

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The card as SVG. */
export function cardSvg(recipe: FixtureRecipe, style: CardStyle): string {
    const lines = recipe.lines.map(l => l.line);
    const perColumn = style.columns === 2 ? Math.ceil(lines.length / 2) : lines.length;
    const rows = Math.max(perColumn, 1);
    const top = 300;
    const lineHeight = Math.min(62, Math.floor((CARD_HEIGHT - top - 110) / rows));
    const fontSize = Math.round(lineHeight * 0.68);
    const colWidth = style.columns === 2 ? 680 : 1300;
    const items = lines.map((line, i) => {
        const col = style.columns === 2 && i >= perColumn ? 1 : 0;
        const row = col ? i - perColumn : i;
        const x = 150 + col * colWidth;
        const y = top + row * lineHeight;
        return `<text x="${x}" y="${y}" font-size="${fontSize}">• ${esc(line)}</text>`;
    }).join('\n');
    const stain = style.stain
        ? `<circle cx="1260" cy="930" r="150" fill="none" stroke="#b08a5a" stroke-opacity="0.35" stroke-width="22"/>`
        : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">
<rect width="100%" height="100%" fill="#8d8478"/>
<g transform="rotate(${style.tilt} ${CARD_WIDTH / 2} ${CARD_HEIGHT / 2})">
<rect x="60" y="50" width="${CARD_WIDTH - 120}" height="${CARD_HEIGHT - 100}" rx="18" fill="${style.paper}"/>
<line x1="110" y1="230" x2="${CARD_WIDTH - 110}" y2="230" stroke="#c0392b" stroke-opacity="0.5" stroke-width="3"/>
<g font-family="${style.font}" fill="${style.ink}">
<text x="150" y="150" font-size="64" font-weight="bold">${esc(recipe.title)}</text>
<text x="150" y="210" font-size="34">Serves ${recipe.servings} · Ingredients</text>
${items}
</g>
${stain}
</g>
</svg>`;
}

/** The card as a JPEG, via sharp (a dependency of Next, used here only offline). */
export async function renderCard(recipe: FixtureRecipe, style: CardStyle): Promise<Buffer> {
    const { default: sharp } = await import('sharp');
    let img = sharp(Buffer.from(cardSvg(recipe, style))).resize(CARD_WIDTH, CARD_HEIGHT);
    if (style.blur > 0) img = img.blur(style.blur);
    return img.jpeg({ quality: 85 }).toBuffer();
}
