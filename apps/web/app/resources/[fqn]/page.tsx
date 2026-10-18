import type { ResourceDetail } from '@registry/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CopyButton } from '@/components/CopyButton';
import { FunctionCard } from '@/components/FunctionCard';
import terminal from '@/components/Terminal.module.css';
import { getResource } from '@/lib/api';
import { formatDate, formatLamports, timeAgo } from '@/lib/format';
import { pageMetadata } from '@/lib/site';
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

/** One line for search results: how many functions, what they cost, and who may call them. */
function summarize(resource: ResourceDetail): string {
  const costs = resource.functions.flatMap((fn) => (fn.paymentManifest ? [fn.paymentManifest.costLamports] : []));
  const restricted = resource.functions.filter((fn) => fn.restricted).length;
  const count = `${resource.functions.length} function${resource.functions.length === 1 ? '' : 's'}`;
  const price =
    costs.length === 0
      ? 'all free'
      : `${costs.length} paid, from ${formatLamports(Math.min(...costs))} per call`;
  const access = restricted === 0 ? 'all open to any caller' : `${restricted} restricted to grant holders`;
  const names = resource.functions.slice(0, 5).map((fn) => `${fn.name}()`);
  const more = resource.functions.length > names.length ? ', …' : '';
  return `${resource.fqn} is a Stellarium resource with ${count}: ${price}; ${access}.${names.length ? ` Functions: ${names.join(', ')}${more}.` : ''}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const fqn = await fqnFrom(params);
  const resource = await getResource(fqn);
  if (!resource) return { title: fqn };
  return {
    // The node's own description says what the resource is for. The summary says what it offers.
    ...pageMetadata({ title: resource.fqn, description: resource.description ?? summarize(resource), path: `/resources/${encodeURIComponent(resource.fqn)}` }),
    // The source node no longer lists it, so search engines should drop it too.
    ...(resource.removedAt && { robots: { index: false, follow: true } }),
  };
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

      {resource.description && <p className={styles.description}>{resource.description}</p>}

      <dl className={styles.meta}>
        {resource.website && (
          <>
            <dt>website</dt>
            <dd>
              {/* Supplied by the node, so search engines shouldn't treat it as the registry's endorsement. */}
              <a href={resource.website} target="_blank" rel="nofollow ugc noreferrer">
                {resource.website}
              </a>
            </dd>
          </>
        )}
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
