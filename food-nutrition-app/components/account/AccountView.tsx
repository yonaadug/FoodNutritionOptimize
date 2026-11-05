'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { apiFetch, clearCurrentUser, primeCurrentUser, refreshCurrentUser, signOut, type CurrentUser } from '@/lib/auth/client';
import { signInPath } from '@/lib/auth/next-path';
import { userInitial } from './AccountMenu';
import HistoryView from './HistoryView';
import styles from './account.module.css';

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** Tells the shared client state who the server rendered this page for. Also used on /account/history. */
export function PrimeUser({ user }: { user: CurrentUser }) {
    useEffect(() => {
        primeCurrentUser(user);
        // Signed out in another tab: this page isn't theirs to see any more.
        const onStorage = (e: StorageEvent) => {
            if (e.key === 'md.signedIn' && e.newValue === null) window.location.replace(signInPath(window.location.pathname));
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [user]);
    return null;
}

export default function AccountView({ user: initialUser }: { user: CurrentUser }) {
    const [user, setUser] = useState(initialUser);
    const [name, setName] = useState(initialUser.displayName);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState('');
    const [signingOut, setSigningOut] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);

    const saveName = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setStatus('');
        try {
            const res = await apiFetch('/api/me', { method: 'PATCH', json: { displayName: name } });
            if (!res.ok) throw new Error(String(res.status));
            const body = (await res.json()) as { user: CurrentUser };
            setUser(body.user);
            setName(body.user.displayName);
            setStatus('Name saved.');
            void refreshCurrentUser();
        } catch {
            setStatus('Couldn\'t save your name. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const doSignOut = async () => {
        setSigningOut(true);
        try {
            await signOut();
            window.location.replace('/');
        } catch {
            setSigningOut(false);
            setStatus('Couldn\'t sign you out. Check your connection and try again.');
        }
    };

    return (
        <>
            <PrimeUser user={initialUser} />
            <div>
                <h1 className={styles.heading}>Your account</h1>
                <p className={styles.lede}>Your details, and the foods, recipes and plans you&apos;ve looked at.</p>
            </div>

            <section className="panel" aria-labelledby="profile-title">
                <h2 id="profile-title" className="sr-only">Profile</h2>
                <div className={styles.profile}>
                    <span className={styles.bigAvatar} aria-hidden="true">{userInitial(user)}</span>
                    <div className={styles.profileText}>
                        {user.displayName && <p className={styles.profileName}>{user.displayName}</p>}
                        <p className={styles.profileEmail} data-testid="account-email">{user.email}</p>
                        <p className={styles.profileMeta}>Member since {longDate(user.createdAt)}</p>
                    </div>
                </div>
                <form className={styles.nameForm} onSubmit={saveName}>
                    <div className={`field ${styles.nameField}`}>
                        <label className="field-label" htmlFor="display-name">Display name (optional)</label>
                        <input id="display-name" className="input" value={name} maxLength={60} autoComplete="name" onChange={e => setName(e.target.value)} />
                    </div>
                    <button type="submit" className="btn btn-secondary" disabled={saving || name.trim() === user.displayName}>
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </form>
                <div className={styles.actions}>
                    <a className="btn btn-secondary" href="/api/account/export" download="micronutrient-diary-account.json">Export my data</a>
                    <button type="button" className="btn btn-ghost" onClick={doSignOut} disabled={signingOut}>
                        {signingOut ? 'Signing out…' : 'Sign out'}
                    </button>
                </div>
                <p className={styles.note}>Signing out also clears your foods, recipes and plan from this browser. Anything saved to your account stays there.</p>
                <p className={styles.status} role="status">{status}</p>
            </section>

            <HistoryView />

            <section className={`panel ${styles.danger}`} aria-labelledby="delete-title">
                <h2 id="delete-title" className={styles.sectionTitle}>Delete account</h2>
                <p className={styles.dangerText}>
                    Permanently removes your profile and history. It can&apos;t be undone, and you can keep using the site without an account.
                </p>
                <div className={styles.actions}>
                    <button type="button" className={`btn ${styles.btnDanger}`} onClick={() => dialog.current?.showModal()}>Delete my account…</button>
                </div>
            </section>

            <DeleteDialog dialogRef={dialog} email={user.email} />
        </>
    );
}

function DeleteDialog({ dialogRef, email }: { dialogRef: React.RefObject<HTMLDialogElement | null>; email: string }) {
    const [typed, setTyped] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');
    const matches = typed.trim().toLowerCase() === email.toLowerCase();

    const close = () => {
        setTyped('');
        setError('');
        dialogRef.current?.close();
    };

    const confirm = async (e: React.FormEvent) => {
        e.preventDefault();
        setDeleting(true);
        setError('');
        try {
            const res = await apiFetch('/api/account', { method: 'DELETE', json: { confirmEmail: typed.trim() } });
            if (!res.ok) throw new Error(String(res.status));
            clearCurrentUser();
            window.location.replace('/account/sign-in?deleted=1');
        } catch {
            setError('Your account wasn\'t deleted. Please try again.');
            setDeleting(false);
        }
    };

    return (
        <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="delete-dialog-title" onClose={() => { setTyped(''); setError(''); }}>
            <form onSubmit={confirm} className="stack">
                <h2 id="delete-dialog-title" className={styles.sectionTitle}>Delete your account?</h2>
                <div className={`${styles.notice} ${styles.noticeDanger}`}>
                    <Icon name="alert" />
                    <span className={styles.noticeBody}>This permanently deletes your profile and all your history. Export your data first if you want a copy.</span>
                </div>
                <div className="field">
                    <label className="field-label" htmlFor="delete-confirm">Type <strong>{email}</strong> to confirm</label>
                    <input id="delete-confirm" className="input" value={typed} autoComplete="off" onChange={e => setTyped(e.target.value)} aria-describedby={error ? 'delete-error' : undefined} />
                </div>
                {error && <p id="delete-error" role="alert" className={styles.fieldError}>{error}</p>}
                <div className={styles.dialogActions}>
                    <button type="button" className="btn btn-ghost" onClick={close} disabled={deleting}>Keep my account</button>
                    <button type="submit" className={`btn ${styles.btnDanger}`} disabled={!matches || deleting}>
                        {deleting ? 'Deleting…' : 'Delete permanently'}
                    </button>
                </div>
            </form>
        </dialog>
    );
}
