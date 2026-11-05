/** Small text helpers shared by matching and conversion. No runtime dependencies. */

/** Singular-ish stem: "eggs" -> "egg", "tomatoes" -> "tomato", "cloves" -> "clove", "leaves" -> "leaf". */
export function wordStem(word: string): string {
    const w = word.toLowerCase();
    if (w.endsWith('leaves')) return w.slice(0, -3) + 'f';
    if (w.length > 4 && /(oes|ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
}

/** Lower-case word tokens (letters and digits). */
export function words(text: string): string[] {
    return text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
}
