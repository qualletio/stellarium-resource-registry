import type { NodeSummary } from '@registry/types';
import type { Metadata } from 'next';
import terminal from '@/components/Terminal.module.css';
import { getNodes, getSyncRuns } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'nodes' };

function grantLabel(node: NodeSummary) {
  if (node.acceptsGrantRequests === null) return <span className={styles.muted}>-</span>;
  return node.acceptsGrantRequests ? <span className={styles.ok}>on request</span> : <span className={styles.danger}>closed</span>;
}

const shortKey = (key: string | null) => (key ? `${key.slice(0, 10)}…${key.slice(-6)}` : '-');

// Rendered per request so builds don't need the API. Fetches are still cached for a few seconds (lib/api.ts).
export const dynamic = 'force-dynamic';

export default async function NodesPage() {
  const [nodes, runs] = await Promise.all([getNodes(), getSyncRuns(10)]);

  return (
    <>
      <p className={terminal.command}>registry nodes --verbose</p>
      <p className={terminal.muted}>
        The source node the registry syncs from, its peers, and every host its resources point at.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>base url</th>
              <th>name</th>
              <th>public key</th>
              <th className={styles.num}>resources</th>
              <th>grants</th>
              <th>seen</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.baseUrl}>
                <td>
                  <code className={styles.url}>{node.baseUrl}</code>
                  {node.isSource && <span className={styles.tag}>source</span>}
                </td>
                <td>{node.name && node.name !== node.baseUrl ? node.name : <span className={styles.muted}>-</span>}</td>
                <td>
                  <code className={styles.muted} title={node.publicKey ?? undefined}>
                    {shortKey(node.publicKey)}
                  </code>
                </td>
                <td className={styles.num}>{node.resourceCount}</td>
                <td>{grantLabel(node)}</td>
                <td className={styles.muted}>{timeAgo(node.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className={terminal.section}>
        <h2 className={terminal.rule}>sync log</h2>
        <ol className={styles.log}>
          {runs.map((run) => (
            <li key={run.id}>
              <span className={run.status === 'succeeded' ? styles.ok : run.status === 'failed' ? styles.danger : styles.amber}>
                [{run.status === 'succeeded' ? ' ok ' : run.status === 'failed' ? 'fail' : ' .. '}]
              </span>{' '}
              <span className={styles.muted}>{timeAgo(run.startedAt)}</span>{' '}
              {run.status === 'failed' ? (
                <span className={styles.danger}>{run.error}</span>
              ) : (
                <span>
                  seen {run.resourcesSeen} · +{run.resourcesAdded} · -{run.resourcesRemoved}
                </span>
              )}
            </li>
          ))}
          {runs.length === 0 && <li className={styles.muted}>no syncs yet</li>}
        </ol>
      </section>
    </>
  );
}
