import type { ResourceSummary } from '@registry/types';
import Link from 'next/link';
import { formatUsdc, timeAgo } from '@/lib/format';
import { AccessIcon } from './AccessIcon';
import { Highlight } from './Highlight';
import styles from './ResourceList.module.css';

function priceLabel(resource: ResourceSummary): string {
  if (!resource.price) return 'free';
  const { minMicroUsdc, maxMicroUsdc } = resource.price;
  const range = minMicroUsdc === maxMicroUsdc ? formatUsdc(minMicroUsdc) : `${formatUsdc(minMicroUsdc).replace(' USDC', '')}–${formatUsdc(maxMicroUsdc)}`;
  return resource.paidFunctionCount < resource.functionCount ? `free / ${range}` : range;
}

/** Results laid out like `ls -l`: access icon, function count, price, name. */
export function ResourceList({ resources, query }: { resources: ResourceSummary[]; query?: string }) {
  return (
    <ul className={styles.list}>
      {resources.map((resource) => (
        <li key={resource.fqn} className={styles.row}>
          <span
            className={resource.restrictedFunctionCount > 0 ? styles.restricted : styles.open}
            title={resource.restrictedFunctionCount > 0 ? `${resource.restrictedFunctionCount} restricted function(s)` : 'all functions open'}
          >
            <AccessIcon restricted={resource.restrictedFunctionCount > 0} />
            <span className={styles.srOnly}>{resource.restrictedFunctionCount > 0 ? 'restricted' : 'open'}</span>
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
            {resource.description && (
              <span className={styles.description} title={resource.description}>
                {resource.description}
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
