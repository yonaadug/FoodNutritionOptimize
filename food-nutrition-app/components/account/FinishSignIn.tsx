'use client';

import { useEffect } from 'react';
import { primeCurrentUser, type CurrentUser } from '@/lib/auth/client';

/** Tells this browser who signed in, then returns to the page they came from. `next` is already checked. */
export default function FinishSignIn({ user, next }: { user: CurrentUser; next: string }) {
    useEffect(() => {
        primeCurrentUser(user);
        window.location.replace(next);
    }, [user, next]);
    return <noscript><a href={next}>Continue</a></noscript>;
}
