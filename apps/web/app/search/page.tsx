import { SEARCH_FIELDS, type SearchField, type SearchQuery } from '@registry/types';
import type { Metadata } from 'next';
import { Pagination } from '@/components/Pagination';
import { ResourceList } from '@/components/ResourceList';
import { SearchPrompt } from '@/components/SearchPrompt';
import terminal from '@/components/Terminal.module.css';
import { searchResources } from '@/lib/api';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'search' };

const PAGE_SIZE = 25;

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function parseQuery(params: Params): Required<Pick<SearchQuery, 'in' | 'paid' | 'restricted' | 'offset'>> & { q: string } {
  const field = first(params.in);
  const offset = Number(first(params.offset));
  return {
    q: (first(params.q) ?? '').slice(0, 200),
    in: SEARCH_FIELDS.includes(field as SearchField) ? (field as SearchField) : 'all',
    paid: first(params.paid) === 'true',
    restricted: first(params.restricted) === 'true',
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

function commandFor(query: ReturnType<typeof parseQuery>): string {
  const parts = ['registry search'];
  if (query.q) parts.push(JSON.stringify(query.q));
  if (query.in !== 'all') parts.push(`--in=${query.in}`);
  if (query.paid) parts.push('--paid');
  if (query.restricted) parts.push('--restricted');
  return parts.join(' ');
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = parseQuery(await searchParams);
  const results = await searchResources({ ...query, limit: PAGE_SIZE });
  const shown = results.items.length;

  return (
    <>
      <SearchPrompt initial={query} live />
      <section className={terminal.section}>
        <p className={terminal.command}>{commandFor(query)}</p>
        {shown === 0 ? (
          <p className={terminal.error}>
            {query.q ? `registry: no resources match "${query.q}"` : 'registry: no resources match these filters'}
          </p>
        ) : (
          <>
            <p className={styles.total}>
              {query.offset + 1}–{query.offset + shown}
              {results.nextOffset !== null ? '+' : ''} results
            </p>
            <ResourceList resources={results.items} query={query.q} />
          </>
        )}
        <Pagination query={query} offset={query.offset} limit={PAGE_SIZE} nextOffset={results.nextOffset} />
      </section>
    </>
  );
}
