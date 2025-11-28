import { NextResponse } from 'next/server';
import { optimizeDiet } from '@/lib/optimizer';

export async function POST(request: Request) {
    try {
        const params = await request.json();
        const result = optimizeDiet(params);

        if (result.error) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json(result);

    } catch (error) {
        console.error('Optimization error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
