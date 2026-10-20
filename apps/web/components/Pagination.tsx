import type { SearchQuery } from '@registry/types';
import Link from 'next/link';
import styles from './Pagination.module.css';

function hrefFor(query: SearchQuery, offset: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.in && query.in !== 'all') params.set('in', query.in);
  if (query.paid) params.set('paid', 'true');
  if (query.restricted) params.set('restricted', 'true');
  if (query.inference) params.set('inference', 'true');
  if (offset > 0) params.set('offset', String(offset));
  const search = params.toString();
  return search ? `/search?${search}` : '/search';
}

export function Pagination({ query, offset, limit, nextOffset }: { query: SearchQuery; offset: number; limit: number; nextOffset: number | null }) {
  if (offset === 0 && nextOffset === null) return null;
  return (
    <nav className={styles.nav} aria-label="Pages">
      {offset > 0 ? <Link href={hrefFor(query, Math.max(0, offset - limit))}>&lt; prev</Link> : <span className={styles.disabled}>&lt; prev</span>}
      <span className={styles.page}>page {Math.floor(offset / limit) + 1}</span>
      {nextOffset !== null ? <Link href={hrefFor(query, nextOffset)}>next &gt;</Link> : <span className={styles.disabled}>next &gt;</span>}
    </nav>
  );
}
