import { SEARCH_FIELDS, type SearchField, type SearchQuery } from '@registry/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EventList } from '@/components/EventList';
import { Pagination } from '@/components/Pagination';
import { ResourceList } from '@/components/ResourceList';
import { SearchPrompt } from '@/components/SearchPrompt';
import terminal from '@/components/Terminal.module.css';
import { searchEvents, searchParamsFor, searchResources } from '@/lib/api';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';


const PAGE_SIZE = 25;
/** Event types shown under a resource search, with a link to the rest. */
const EVENT_PREVIEW = 3;

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function parseQuery(params: Params): Required<Pick<SearchQuery, 'in' | 'paid' | 'restricted' | 'inference' | 'contract' | 'offset'>> & { q: string } {
  const field = first(params.in);
  const offset = Number(first(params.offset));
  return {
    q: (first(params.q) ?? '').slice(0, 200),
    in: SEARCH_FIELDS.includes(field as SearchField) ? (field as SearchField) : 'all',
    paid: first(params.paid) === 'true',
    restricted: first(params.restricted) === 'true',
    inference: first(params.inference) === 'true',
    contract: first(params.contract) === 'true',
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

function commandFor(query: ReturnType<typeof parseQuery>): string {
  const parts = ['registry search'];
  if (query.q) parts.push(JSON.stringify(query.q));
  if (query.in !== 'all') parts.push(`--in=${query.in}`);
  if (query.paid) parts.push('--paid');
  if (query.restricted) parts.push('--restricted');
  if (query.inference) parts.push('--inference');
  if (query.contract) parts.push('--contract');
  return parts.join(' ');
}

/** Result pages are kept out of the index (there's one per query), but their links are still followed. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const filtered = Object.keys(await searchParams).length > 0;
  return {
    ...pageMetadata({ title: 'search', description: 'Search Stellarium resources and contracts by path, name or function, and filter by price and access.', path: '/search' }),
    ...(filtered && { robots: { index: false, follow: true } }),
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = parseQuery(await searchParams);
  // Events match a query too, unless a filter only resources have is on.
  const resourceFilters = query.in !== 'all' || query.paid || query.inference || query.contract;
  const [results, events] = await Promise.all([
    searchResources({ ...query, limit: PAGE_SIZE }),
    query.q && !resourceFilters && query.offset === 0 ? searchEvents({ q: query.q, restricted: query.restricted, limit: EVENT_PREVIEW }) : undefined,
  ]);
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
        <Pagination
          href={(offset) => {
            const params = searchParamsFor({ ...query, offset }).toString();
            return params ? `/search?${params}` : '/search';
          }}
          offset={query.offset}
          limit={PAGE_SIZE}
          nextOffset={results.nextOffset}
        />
      </section>
      {events && events.items.length > 0 && (
        <section className={terminal.section}>
          <h2 className={terminal.rule}>events</h2>
          <EventList events={events.items} query={query.q} />
          {events.nextOffset !== null && (
            <p className={styles.total}>
              <Link href={`/events?${new URLSearchParams({ q: query.q, ...(query.restricted && { restricted: 'true' }) })}`}>more events →</Link>
            </p>
          )}
        </section>
      )}
    </>
  );
}
