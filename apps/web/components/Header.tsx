import Link from 'next/link';
import styles from './Header.module.css';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { href: '/search', label: 'search' },
];

export function Header() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <span className={styles.user}>registry</span>
        <span className={styles.at}>@</span>
        <span className={styles.host}>stellarium</span>
        <span className={styles.colon}>:~$</span>
      </Link>
      <nav className={styles.nav} aria-label="Main">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className={styles.link}>
            ./{item.label}
          </Link>
        ))}
      </nav>
      <ThemeToggle />
    </header>
  );
}
