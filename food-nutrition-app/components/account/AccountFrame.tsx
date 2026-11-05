import styles from './account.module.css';

/** The <main> of an /account page. The header, footer and skip link come from app/layout.tsx. */
export default function AccountFrame({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
    return <main className={`container ${styles.main} ${narrow ? styles.narrow : ''}`}>{children}</main>;
}
