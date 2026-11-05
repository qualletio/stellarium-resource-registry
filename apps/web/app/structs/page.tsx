import type { Metadata } from 'next';
import { Pagination } from '@/components/Pagination';
import { StructList } from '@/components/StructList';
import { StructSearch } from '@/components/StructSearch';
import terminal from '@/components/Terminal.module.css';
import { searchStructs, structSearchParamsFor } from '@/lib/api';
import { pageMetadata } from '@/lib/site';
import styles from '../search/page.module.css';

const PAGE_SIZE = 25;

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function parseQuery(params: Params) {
  const offset = Number(first(params.offset));
  return {
    q: (first(params.q) ?? '').slice(0, 200),
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

/** Filtered pages are kept out of the index (there's one per query), but their links are still followed. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const filtered = Object.keys(await searchParams).length > 0;
  return {
    ...pageMetadata({
      title: 'structs',
      description: 'Structs on the Stellarium network: the named, versioned object shapes functions, contracts and events use as types.',
      path: '/structs',
    }),
    ...(filtered && { robots: { index: false, follow: true } }),
  };
}

export default async function StructsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = parseQuery(await searchParams);
  const results = await searchStructs({ ...query, limit: PAGE_SIZE });
  const shown = results.items.length;
  const command = ['registry structs', ...(query.q ? [JSON.stringify(query.q)] : [])].join(' ');

  return (
    <>
      <StructSearch q={query.q} autoFocus={!query.q} />
      <p className={`${terminal.muted} ${styles.total}`}>
        A struct names a shape of object: its fields and their types. Organizations declare them on their nodes, and anyone may use
        one as a type by naming its version, which never changes.
      </p>
      <section className={terminal.section}>
        <p className={terminal.command}>{command}</p>
        {shown === 0 ? (
          <p className={terminal.error}>{query.q ? `registry: no structs match "${query.q}"` : 'registry: no structs yet'}</p>
        ) : (
          <>
            <p className={styles.total}>
              {query.offset + 1}–{query.offset + shown}
              {results.nextOffset !== null ? '+' : ''} structs
            </p>
            <StructList structs={results.items} query={query.q} />
          </>
        )}
        <Pagination
          href={(offset) => {
            const params = structSearchParamsFor({ ...query, offset }).toString();
            return params ? `/structs?${params}` : '/structs';
          }}
          offset={query.offset}
          limit={PAGE_SIZE}
          nextOffset={results.nextOffset}
        />
      </section>
    </>
  );
}
