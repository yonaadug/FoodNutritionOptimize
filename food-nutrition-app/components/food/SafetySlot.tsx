import ContaminantPanel from '@/components/contaminants/ContaminantPanel';

/**
 * "Contaminants" section of the food page. `servingGrams` follows the serving selector,
 * so the panel's meters scale with it.
 */
export default function SafetySlot({ fdcId, servingGrams }: { fdcId: number; servingGrams: number }) {
    return <ContaminantPanel fdcId={fdcId} servingGrams={servingGrams} />;
}
