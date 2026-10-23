import { isInferenceManifest, type ResourceDetail } from '@registry/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CopyButton } from '@/components/CopyButton';
import { FunctionCard } from '@/components/FunctionCard';
import terminal from '@/components/Terminal.module.css';
import { getResource } from '@/lib/api';
import { formatDate, formatUsd, timeAgo } from '@/lib/format';
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

/** Per-call costs of the paid fixed functions, and how many paid inference functions are priced per token instead. */
function pricing(resource: ResourceDetail) {
  const manifests = resource.functions.flatMap((fn) => (fn.paymentManifest ? [fn.paymentManifest] : []));
  const costs = manifests.flatMap((manifest) => (isInferenceManifest(manifest) ? [] : [manifest.costMicroUsd]));
  return { paid: manifests.length, costs, perToken: manifests.length - costs.length };
}

/** One line for search results: how many functions, what they cost, and who may call them. */
function summarize(resource: ResourceDetail): string {
  const { paid, costs, perToken } = pricing(resource);
  const restricted = resource.functions.filter((fn) => fn.restricted).length;
  const count = `${resource.functions.length} function${resource.functions.length === 1 ? '' : 's'}`;
  const prices = [
    ...(costs.length > 0 ? [`from ${formatUsd(Math.min(...costs))} per call`] : []),
    ...(perToken > 0 ? [`${perToken} priced per token`] : []),
  ];
  const price = paid === 0 ? 'all free' : `${paid} paid, ${prices.join(', ')}`;
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

  const { paid, costs, perToken } = pricing(resource);
  const restricted = resource.functions.filter((fn) => fn.restricted).length;
  const inference = resource.functions.filter((fn) => fn.kind === 'inference').length;
  const perCall =
    costs.length === 0
      ? undefined
      : Math.min(...costs) === Math.max(...costs)
        ? `${formatUsd(costs[0])} per call`
        : `${formatUsd(Math.min(...costs))} – ${formatUsd(Math.max(...costs))} per call`;

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
          {resource.functions.length} total · <span className={styles.amber}>{paid} paid</span> ·{' '}
          {inference > 0 && (
            <>
              <span className={styles.cyan}>{inference} inference</span> ·{' '}
            </>
          )}
          <span className={styles.danger}>{restricted} restricted</span>
        </dd>
        <dt>pricing</dt>
        <dd>
          {paid === 0
            ? 'free'
            : [perCall, perToken > 0 && `${perToken} inference function${perToken === 1 ? '' : 's'} priced per token`].filter(Boolean).join(' · ')}
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
