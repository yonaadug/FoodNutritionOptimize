import type { SkeletonKind } from '@/lib/navigation-ux';

/**
 * Loading skeletons for the pages that read the database, shown by NavigationEffects
 * over the old page when the next one takes a moment to arrive. Each uses the real
 * page's layout classes, so the page arrives in the same place. No spinners; the shimmer
 * stops for anyone who prefers reduced motion.
 *
 * These are only ever drawn in the browser, during a client-side page change: the server's
 * HTML for every page is the full page, so search engines and visitors without JavaScript
 * get the content itself (a loading.tsx would put a skeleton there instead).
 */
const Bar = ({ className = 'sk-line', width, height, style }: { className?: string; width?: number | string; height?: number; style?: React.CSSProperties }) => (
    <div className={`skeleton ${className}`} style={{ width, height, ...style }} />
);

function Breadcrumb({ levels }: { levels: number }) {
    return (
        <div className="sk-row" style={{ minHeight: 20 }}>
            {Array.from({ length: levels }, (_, i) => <Bar key={i} width={i === levels - 1 ? 120 : 56} />)}
        </div>
    );
}

function FoodPage() {
    return (
        <div className="container food-page">
            <Breadcrumb levels={3} />
            <div className="food-head">
                <Bar className="sk-title" width="min(560px, 80%)" />
                <Bar width="min(320px, 55%)" height={18} />
                <div className="sk-row"><Bar width={70} height={18} /></div>
            </div>
            <div className="food-actions-wrap">
                <div className="sk-row">
                    <Bar className="sk-pill" width={150} />
                    <Bar className="sk-pill" width={170} />
                    <Bar className="sk-pill" width={110} />
                    <Bar className="sk-pill" width={96} />
                </div>
                <Bar width="min(560px, 90%)" height={12} />
            </div>
            <div className="food-layout">
                <div className="food-label-col">
                    <Bar width={90} height={14} />
                    <Bar className="sk-pill" width="100%" />
                    <Bar className="sk-panel" width="100%" height={620} />
                </div>
                <div className="food-data-col">
                    <div className="sk-row"><Bar width={56} /><Bar className="sk-chip" /><Bar className="sk-chip" /><Bar className="sk-chip" /></div>
                    <Bar className="sk-panel" width="100%" height={900} />
                </div>
            </div>
        </div>
    );
}

function FoodList() {
    return (
        <div className="container food-page">
            <Breadcrumb levels={3} />
            <div className="food-head">
                <Bar className="sk-title" width="min(480px, 75%)" />
                <Bar width="min(520px, 85%)" />
            </div>
            <div className="panel">
                {Array.from({ length: 8 }, (_, i) => (
                    <div className="sk-result" key={i}>
                        <div>
                            <Bar width={`${55 + ((i * 17) % 30)}%`} height={15} />
                            <div className="sk-row"><Bar className="sk-chip" /><Bar width={60} height={18} /></div>
                            <Bar width="45%" />
                        </div>
                        <Bar width={72} height={22} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function LinkIndex() {
    return (
        <div className="container food-page">
            <Breadcrumb levels={2} />
            <div className="food-head">
                <Bar className="sk-title" width="min(460px, 75%)" />
            </div>
            <div className="category-list">
                {Array.from({ length: 18 }, (_, i) => <Bar key={i} className="sk-list-item" />)}
            </div>
        </div>
    );
}

function Home() {
    return (
        <div className="container explore">
            <div className="explore-hero" style={{ width: '100%' }}>
                <Bar className="sk-title sk-center" width="min(520px, 85%)" />
                <Bar className="sk-center" width="min(600px, 90%)" style={{ marginTop: 14 }} />
            </div>
            <Bar className="sk-search" />
            <div className="explore-browse">
                <div>
                    <Bar width={150} height={18} style={{ marginBottom: 12 }} />
                    <div className="food-grid">
                        {Array.from({ length: 12 }, (_, i) => <Bar key={i} className="sk-card" width="100%" />)}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Account() {
    return (
        <div className="container food-page">
            <div className="food-head" style={{ marginTop: 0 }}>
                <Bar className="sk-title" width="min(320px, 70%)" />
                <Bar width="min(480px, 85%)" />
            </div>
            <Bar className="sk-panel" width="100%" height={260} />
            <Bar className="sk-panel" width="100%" height={180} />
        </div>
    );
}

const SKELETONS: Record<SkeletonKind, () => React.ReactElement> = {
    home: Home,
    food: FoodPage,
    'food-list': FoodList,
    'link-index': LinkIndex,
    account: Account,
};

export default function PageSkeleton({ kind }: { kind: SkeletonKind }) {
    const Skeleton = SKELETONS[kind];
    return <Skeleton />;
}
