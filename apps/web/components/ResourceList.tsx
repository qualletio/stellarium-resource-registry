import type { ResourceSummary } from '@registry/types';
import Link from 'next/link';
import { formatLamports, timeAgo } from '@/lib/format';
import { Highlight } from './Highlight';
import styles from './ResourceList.module.css';

function priceLabel(resource: ResourceSummary): string {
  if (!resource.price) return 'free';
  const { minLamports, maxLamports } = resource.price;
  const range = minLamports === maxLamports ? formatLamports(minLamports) : `${formatLamports(minLamports)}–${formatLamports(maxLamports).replace(' lamports', '')}`;
  return resource.paidFunctionCount < resource.functionCount ? `free / ${range}` : range;
}

/** Results laid out like `ls -l`: access, function count, price, name. */
export function ResourceList({ resources, query }: { resources: ResourceSummary[]; query?: string }) {
  return (
    <ul className={styles.list}>
      {resources.map((resource) => (
        <li key={resource.fqn} className={styles.row}>
          <span className={styles.mode} title={resource.restrictedFunctionCount > 0 ? `${resource.restrictedFunctionCount} restricted function(s)` : 'all functions open'}>
            {resource.restrictedFunctionCount > 0 ? 'r-x---' : 'r-xr-x'}
          </span>
          <span className={styles.count} title="functions">
            {String(resource.functionCount).padStart(2, ' ')} fn
          </span>
          <span className={resource.price ? styles.paid : styles.free} title="price per call">{priceLabel(resource)}</span>
          <span className={styles.name}>
            <Link href={`/resources/${encodeURIComponent(resource.fqn)}`}>
              <span className={styles.path}>
                <Highlight text={resource.path} query={query} />.
              </span>
              <span className={styles.resourceName}>
                <Highlight text={resource.name} query={query} />
              </span>
            </Link>
            {resource.matchedFunctions.length > 0 && (
              <span className={styles.matched}>
                {' '}→ {resource.matchedFunctions.map((fn, index) => (
                  <span key={fn}>
                    {index > 0 && ', '}
                    <Highlight text={fn} query={query} />()
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className={styles.seen} title={resource.lastSeenAt}>
            {timeAgo(resource.lastSeenAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
