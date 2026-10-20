import type { ResourceSummary } from '@registry/types';
import Link from 'next/link';
import { formatUsdc, timeAgo } from '@/lib/format';
import { AccessIcon } from './AccessIcon';
import { Highlight } from './Highlight';
import styles from './ResourceList.module.css';

/** "free", a per-call range, "per token" for paid inference functions, or a mix: "free / 0.01 USDC / per token". */
function priceLabel(resource: ResourceSummary): string {
  const parts: string[] = [];
  if (resource.paidFunctionCount < resource.functionCount) parts.push('free');
  if (resource.price) {
    const { minMicroUsdc, maxMicroUsdc } = resource.price;
    parts.push(minMicroUsdc === maxMicroUsdc ? formatUsdc(minMicroUsdc) : `${formatUsdc(minMicroUsdc).replace(' USDC', '')}–${formatUsdc(maxMicroUsdc)}`);
  }
  if (resource.perTokenFunctionCount > 0) parts.push('per token');
  return parts.join(' / ');
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
          <span className={resource.paidFunctionCount > 0 ? styles.paid : styles.free} title="price per call, or per token for inference functions">
            {priceLabel(resource)}
          </span>
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
