import type { Metadata } from 'next';
import { EventList } from '@/components/EventList';
import { EventSearch } from '@/components/EventSearch';
import { Pagination } from '@/components/Pagination';
import terminal from '@/components/Terminal.module.css';
import { eventSearchParamsFor, searchEvents } from '@/lib/api';
import { pageMetadata } from '@/lib/site';
import styles from '../search/page.module.css';

const PAGE_SIZE = 25;

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function parseQuery(params: Params) {
  const offset = Number(first(params.offset));
  return {
    q: (first(params.q) ?? '').slice(0, 200),
    restricted: first(params.restricted) === 'true',
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

/** Filtered pages are kept out of the index (there's one per query), but their links are still followed. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const filtered = Object.keys(await searchParams).length > 0;
  return {
    ...pageMetadata({
      title: 'events',
      description: 'Event types on the Stellarium network, the fields their events carry, and the event contracts that consume them.',
      path: '/events',
    }),
    ...(filtered && { robots: { index: false, follow: true } }),
  };
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = parseQuery(await searchParams);
  const results = await searchEvents({ ...query, limit: PAGE_SIZE });
  const shown = results.items.length;
  const command = ['registry events', ...(query.q ? [JSON.stringify(query.q)] : []), ...(query.restricted ? ['--restricted'] : [])].join(' ');

  return (
    <>
      <EventSearch q={query.q} restricted={query.restricted} autoFocus={!query.q} />
      <p className={`${terminal.muted} ${styles.total}`}>
        Organizations declare event types on their nodes, and their scripts emit them. Event contracts, deployed by anyone on any node,
        run with each event of the type they consume.
      </p>
      <section className={terminal.section}>
        <p className={terminal.command}>{command}</p>
        {shown === 0 ? (
          <p className={terminal.error}>{query.q ? `registry: no events match "${query.q}"` : 'registry: no events match these filters'}</p>
        ) : (
          <>
            <p className={styles.total}>
              {query.offset + 1}–{query.offset + shown}
              {results.nextOffset !== null ? '+' : ''} event types
            </p>
            <EventList events={results.items} query={query.q} />
          </>
        )}
        <Pagination
          href={(offset) => {
            const params = eventSearchParamsFor({ ...query, offset }).toString();
            return params ? `/events?${params}` : '/events';
          }}
          offset={query.offset}
          limit={PAGE_SIZE}
          nextOffset={results.nextOffset}
        />
      </section>
    </>
  );
}
