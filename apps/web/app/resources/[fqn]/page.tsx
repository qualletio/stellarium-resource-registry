import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CopyButton } from '@/components/CopyButton';
import { FunctionCard } from '@/components/FunctionCard';
import terminal from '@/components/Terminal.module.css';
import { getResource } from '@/lib/api';
import { formatDate, formatLamports, timeAgo } from '@/lib/format';
import styles from './page.module.css';

type Props = { params: Promise<{ fqn: string }> };

async function fqnFrom(params: Props['params']): Promise<string> {
  const { fqn } = await params;
  try {
    return decodeURIComponent(fqn);
  } catch {
    return fqn;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: await fqnFrom(params) };
}

export default async function ResourcePage({ params }: Props) {
  const resource = await getResource(await fqnFrom(params));
  if (!resource) notFound();

  const paid = resource.functions.filter((fn) => fn.paymentManifest);
  const restricted = resource.functions.filter((fn) => fn.restricted).length;
  const costs = paid.map((fn) => fn.paymentManifest?.costLamports ?? 0);

  return (
    <>
      <p className={terminal.command}>registry describe {resource.fqn}</p>

      {resource.removedAt && (
        <p className={styles.removed}>
          warning: the source node no longer lists {resource.fqn}. It was last listed {timeAgo(resource.lastSeenAt)}.
        </p>
      )}

      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.path}>{resource.path}.</span>
          <span className={styles.name}>{resource.name}</span>
        </h1>
        <CopyButton value={resource.fqn} label="copy fqn" />
      </header>

      <dl className={styles.meta}>
        <dt>functions</dt>
        <dd>
          {resource.functions.length} total · <span className={styles.amber}>{paid.length} paid</span> ·{' '}
          <span className={styles.danger}>{restricted} restricted</span>
        </dd>
        <dt>pricing</dt>
        <dd>
          {costs.length === 0
            ? 'free'
            : Math.min(...costs) === Math.max(...costs)
              ? `${formatLamports(costs[0])} per call`
              : `${formatLamports(Math.min(...costs))} – ${formatLamports(Math.max(...costs))} per call`}
        </dd>
        <dt>grants</dt>
        <dd>
          {restricted === 0 ? (
            <span className={styles.muted}>not needed: every function is open</span>
          ) : resource.host?.acceptsGrantRequests ? (
            <span className={styles.ok}>host issues grants on request</span>
          ) : resource.host?.acceptsGrantRequests === false ? (
            <span className={styles.danger}>host does not issue grants on request</span>
          ) : (
            <span className={styles.muted}>unknown: host not probed yet</span>
          )}
        </dd>
        <dt>first seen</dt>
        <dd>{formatDate(resource.firstSeenAt)}</dd>
        <dt>last seen</dt>
        <dd>
          {formatDate(resource.lastSeenAt)} <span className={styles.muted}>({timeAgo(resource.lastSeenAt)})</span>
        </dd>
      </dl>

      <section className={terminal.section}>
        <h2 className={terminal.rule}>functions</h2>
        {resource.functions.length === 0 ? (
          <p className={terminal.muted}>This resource declares no functions.</p>
        ) : (
          <div className={styles.functions}>
            {resource.functions.map((fn) => (
              <FunctionCard key={fn.name} path={resource.path} name={resource.name} fn={fn} host={resource.host} />
            ))}
          </div>
        )}
      </section>

      <p className={styles.back}>
        <Link href="/search">cd ..</Link>
      </p>
    </>
  );
}
