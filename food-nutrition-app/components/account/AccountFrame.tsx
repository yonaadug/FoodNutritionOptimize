import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import Icon from '@/components/ui/Icon';
import AccountMenu from './AccountMenu';
import styles from './account.module.css';

/**
 * Page chrome for /account/*. It uses the same global header classes as the rest of
 * the site. If the shell's header becomes global, replace this <header> with it.
 */
export default function AccountFrame({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
    return (
        <>
            <a href="#main" className="skip-link">Skip to content</a>
            <header className="site-header">
                <div className="container site-header-inner">
                    <Link href="/" className="brand" aria-label="Micronutrient Diary home">
                        <span className="brand-mark"><Icon name="leaf" size={17} strokeWidth={2.4} /></span>
                        Micronutrient Diary
                    </Link>
                    <span className="spacer" />
                    <ThemeToggle />
                    <AccountMenu />
                </div>
            </header>
            <main id="main" className={`container ${styles.main} ${narrow ? styles.narrow : ''}`}>
                {children}
            </main>
        </>
    );
}
