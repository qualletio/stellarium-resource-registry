import type { StructSummary } from '@registry/types';
import Link from 'next/link';
import { eventFields, structHref, timeAgo } from '@/lib/format';
import { Highlight } from './Highlight';
import styles from './StructList.module.css';

/** Structs laid out like `ls -l`: how many versions each has, its latest fields, and when it was last listed. */
export function StructList({ structs, query }: { structs: StructSummary[]; query?: string }) {
  return (
    <ul className={styles.list}>
      {structs.map((struct) => (
        <li key={struct.fqn} className={styles.row}>
          <span className={styles.count} title="declared versions">
            {String(struct.versionCount).padStart(2, ' ')} v
          </span>
          <span className={styles.name}>
            <Link href={structHref(struct.fqn)}>
              <span className={styles.path}>
                <Highlight text={struct.path} query={query} />.
              </span>
              <span className={styles.structName}>
                <Highlight text={struct.name} query={query} />
              </span>
              <span className={styles.version}>@{struct.latestVersion}</span>
            </Link>
            <span className={styles.fields}>
              <Highlight text={eventFields(struct.fields)} query={struct.matchedFields.length > 0 ? query : undefined} />
            </span>
            {struct.description && (
              <span className={styles.description} title={struct.description}>
                {struct.description}
              </span>
            )}
          </span>
          <span className={styles.seen} title={struct.lastSeenAt}>
            {timeAgo(struct.lastSeenAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
