import { NextRequest, NextResponse } from 'next/server';
import { getFoodsByIds } from '@/lib/db';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const idsParam = searchParams.get('ids');

    if (!idsParam) {
        return NextResponse.json({ error: 'IDs parameter required' }, { status: 400 });
    }

    try {
        const ids = idsParam.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
        const foods = await getFoodsByIds(ids);
        return NextResponse.json({ foods });
    } catch (error) {
        console.error('Foods fetch error:', error);
        return NextResponse.json({ error: 'Failed to fetch foods' }, { status: 500 });
    }
}
