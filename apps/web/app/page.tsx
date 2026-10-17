import Link from 'next/link';
import { Banner } from '@/components/Banner';
import { ResourceList } from '@/components/ResourceList';
import { SearchPrompt } from '@/components/SearchPrompt';
import { StatusLine } from '@/components/StatusLine';
import terminal from '@/components/Terminal.module.css';
import { getStats, searchResources } from '@/lib/api';
import styles from './page.module.css';

// Rendered per request so builds don't need the API. Fetches are still cached for a few seconds (lib/api.ts).
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [stats, recent] = await Promise.all([getStats(), searchResources({ limit: 8 })]);

  return (
    <>
      <section className={styles.hero}>
        <h1 className={styles.title}>
          <Banner lines={['stellarium', 'registry']} label="Stellarium Registry" />
        </h1>
        <p className={styles.tagline}>
          A public index of the resources on the Stellarium network. Find a resource by path, name or function, and see what each
          call costs and who may make it.
          <span className={terminal.cursor} aria-hidden="true" />
        </p>
        <SearchPrompt initial={{ q: '', in: 'all', paid: false, restricted: false }} autoFocus />
      </section>

      <section className={terminal.section}>
        <StatusLine stats={stats} />
      </section>

      <section className={terminal.section}>
        <h2 className={terminal.rule}>recently discovered</h2>
        {recent.items.length > 0 ? (
          <ResourceList resources={recent.items} />
        ) : (
          <p className={terminal.muted}>No resources yet. The registry fills in after its first sync with {stats.sourceUrl}.</p>
        )}
        {recent.nextOffset !== null && (
          <p className={styles.more}>
            <Link href="/search">ls --all →</Link>
          </p>
        )}
      </section>

      <section className={terminal.section}>
        <h2 className={terminal.rule}>man registry</h2>
        <dl className={styles.man}>
          <dt>resource</dt>
          <dd>
            A named set of functions hosted by a node, addressed as <code>path.Name</code> (<code>com.example.Weather</code>). Requests
            bind and call them with RequestScript.
          </dd>
          <dt>paid</dt>
          <dd>
            A function with a <code>paymentManifest</code> costs a fixed number of lamports per call. Your node pays it with a signed
            voucher, settled on Solana from your escrow.
          </dd>
          <dt>restricted</dt>
          <dd>
            Only callers holding a grant from the hosting node may call it. Some nodes issue grants on request. The registry checks
            each host and shows whether it does.
          </dd>
        </dl>
      </section>
    </>
  );
}
