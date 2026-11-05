/**
 * EXTENSION POINT: "Contaminants & safety" section of the food page.
 *
 * Renders nothing until the contaminants panel is merged. To mount it, replace
 * the body with:
 *
 *     import ContaminantPanel from '@/components/contaminants/ContaminantPanel';
 *     return <ContaminantPanel fdcId={fdcId} servingGrams={servingGrams} />;
 *
 * `servingGrams` follows the serving selector, so the panel can scale with it.
 * The panel should render nothing when it has no data for a food.
 */
export default function SafetySlot({ fdcId, servingGrams }: { fdcId: number; servingGrams: number }) {
    void fdcId;
    void servingGrams;
    return null;
}
