import Link from 'next/link';
import styles from './Pagination.module.css';

interface Props {
  /** The page starting at `offset`, with the current query. */
  href: (offset: number) => string;
  offset: number;
  limit: number;
  nextOffset: number | null;
}

export function Pagination({ href, offset, limit, nextOffset }: Props) {
  if (offset === 0 && nextOffset === null) return null;
  return (
    <nav className={styles.nav} aria-label="Pages">
      {offset > 0 ? <Link href={href(Math.max(0, offset - limit))}>&lt; prev</Link> : <span className={styles.disabled}>&lt; prev</span>}
      <span className={styles.page}>page {Math.floor(offset / limit) + 1}</span>
      {nextOffset !== null ? <Link href={href(nextOffset)}>next &gt;</Link> : <span className={styles.disabled}>next &gt;</span>}
    </nav>
  );
}
