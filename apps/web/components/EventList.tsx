import type { EventTypeSummary } from '@registry/types';
import Link from 'next/link';
import { eventFields, timeAgo } from '@/lib/format';
import { AccessIcon } from './AccessIcon';
import styles from './EventList.module.css';
import { Highlight } from './Highlight';

/** Event types laid out like `ls -l`: who may consume them, how many event contracts do, and their latest fields. */
export function EventList({ events, query }: { events: EventTypeSummary[]; query?: string }) {
  return (
    <ul className={styles.list}>
      {events.map((event) => (
        <li key={event.fqn} className={styles.row}>
          <span
            className={event.restricted ? styles.restricted : styles.open}
            title={event.restricted ? 'restricted: only its owner\'s contracts receive it' : 'any contract may consume it'}
          >
            <AccessIcon restricted={event.restricted} />
            <span className={styles.srOnly}>{event.restricted ? 'restricted' : 'open'}</span>
          </span>
          <span className={styles.count} title="event contracts consuming it">
            {String(event.consumerCount).padStart(2, ' ')} ⇠
          </span>
          <span className={styles.name}>
            <Link href={`/events/${encodeURIComponent(event.fqn)}`}>
              <span className={styles.path}>
                <Highlight text={event.path} query={query} />.
              </span>
              <span className={styles.eventName}>
                <Highlight text={event.name} query={query} />
              </span>
              <span className={styles.version}>@{event.latestVersion}</span>
            </Link>
            <span className={styles.fields}>
              <Highlight text={eventFields(event.fields)} query={event.matchedFields.length > 0 ? query : undefined} />
            </span>
            {event.matchedConsumers.length > 0 && (
              <span className={styles.matched}>
                {' '}⇠ {event.matchedConsumers.map((fqn, index) => (
                  <span key={fqn}>
                    {index > 0 && ', '}
                    <Highlight text={fqn} query={query} />
                  </span>
                ))}
              </span>
            )}
            {event.description && (
              <span className={styles.description} title={event.description}>
                {event.description}
              </span>
            )}
          </span>
          <span className={styles.seen} title={event.lastSeenAt}>
            {timeAgo(event.lastSeenAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
