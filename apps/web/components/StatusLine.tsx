import type { Stats } from '@registry/types';
import { timeAgo } from '@/lib/format';
import styles from './StatusLine.module.css';

export function StatusLine({ stats }: { stats: Stats }) {
  const sync = stats.lastSync;
  return (
    <p className={styles.line}>
      <span className={sync ? styles.ok : styles.warn}>[{sync ? ' ok ' : 'wait'}]</span>{' '}
      <b>{stats.resources}</b> resources · <b>{stats.functions}</b> functions · <b className={styles.amber}>{stats.paidFunctions}</b> paid ·{' '}
      <b className={styles.danger}>{stats.restrictedFunctions}</b> restricted · <b>{stats.nodes}</b> nodes ·{' '}
      <span className={styles.muted}>{sync?.finishedAt ? `synced ${timeAgo(sync.finishedAt)}` : 'awaiting first sync'}</span>
    </p>
  );
}
