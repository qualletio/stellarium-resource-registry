import type { ContractVersion, EventContractDetail } from '@registry/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContractSection } from '@/components/ContractSection';
import { CopyButton } from '@/components/CopyButton';
import styles from '@/components/Detail.module.css';
import terminal from '@/components/Terminal.module.css';
import { getEventContract, getEventContractVersion } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { pageMetadata } from '@/lib/site';

type Props = { params: Promise<{ fqn: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function fqnFrom(params: Props['params']): Promise<string> {
  const { fqn } = await params;
  try {
    return decodeURIComponent(fqn);
  } catch {
    return fqn;
  }
}

/** The version `?version=` names, or the latest. `missing` is set when the named one doesn't exist. */
async function shownVersion(detail: EventContractDetail, requested: string | undefined): Promise<{ shown: Pick<ContractVersion, 'version' | 'source'> | null; missing?: string }> {
  const { contract } = detail;
  const latest = contract.latestVersion && contract.source !== null ? { version: contract.latestVersion, source: contract.source } : null;
  if (!requested || requested === contract.latestVersion) return { shown: latest };
  if (!contract.versions.some((version) => version.version === requested)) return { shown: latest, missing: requested };
  return { shown: (await getEventContractVersion(detail.fqn, requested)) ?? latest };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const fqn = await fqnFrom(params);
  const detail = await getEventContract(fqn);
  if (!detail) return { title: fqn };
  const summary = `${detail.fqn} is a Stellarium event contract: a RequestScript script that runs with each ${detail.consumes.fqn} event, with public source.`;
  return {
    ...pageMetadata({ title: detail.fqn, description: detail.description ?? summary, path: `/event-contracts/${encodeURIComponent(detail.fqn)}` }),
    ...(detail.removedAt && { robots: { index: false, follow: true } }),
  };
}

export default async function EventContractPage({ params, searchParams }: Props) {
  const detail = await getEventContract(await fqnFrom(params));
  if (!detail) notFound();
  const requested = (await searchParams).version;
  const { shown, missing } = await shownVersion(detail, Array.isArray(requested) ? requested[0] : requested);
  const event = `${detail.consumes.fqn}@${detail.consumes.version}`;

  return (
    <>
      <p className={terminal.command}>registry describe {detail.fqn}</p>

      {detail.removedAt && (
        <p className={styles.removed}>
          warning: the node hosting {detail.fqn} no longer lists it. It was last listed {timeAgo(detail.lastSeenAt)}.
        </p>
      )}

      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.path}>{detail.path}.</span>
          <span className={styles.name}>{detail.name}</span>
          {detail.contract.latestVersion && <span className={styles.version}>@{detail.contract.latestVersion}</span>}
        </h1>
        <span className={styles.contractBadge}>event contract</span>
        <CopyButton value={detail.fqn} label="copy fqn" />
      </header>

      {detail.description && <p className={styles.description}>{detail.description}</p>}

      <dl className={styles.meta}>
        <dt>consumes</dt>
        <dd>
          {detail.consumes.known ? (
            <Link href={`/events/${encodeURIComponent(detail.consumes.fqn)}`}>{event}</Link>
          ) : (
            <>
              <code>{event}</code> <span className={styles.muted}>(not in the registry)</span>
            </>
          )}
        </dd>
        <dt>runs</dt>
        <dd>
          with each event, once per event <span className={styles.muted}>· it isn&apos;t a resource, so nobody can call it</span>
        </dd>
        <dt>paid by</dt>
        <dd>
          {detail.contract.ownerOrganizationId ? (
            <>
              <code>{detail.contract.ownerOrganizationId}</code> <span className={styles.muted}>· whoever deployed it pays for its runs</span>
            </>
          ) : (
            <span className={styles.muted}>unknown: its node doesn&apos;t say who deployed it</span>
          )}
        </dd>
        <dt>host</dt>
        <dd>
          {detail.host?.name && detail.host.name !== detail.baseUrl ? `${detail.host.name} · ` : ''}
          <code>{detail.baseUrl}</code>
        </dd>
        <dt>first seen</dt>
        <dd>{formatDate(detail.firstSeenAt)}</dd>
        <dt>last seen</dt>
        <dd>
          {formatDate(detail.lastSeenAt)} <span className={styles.muted}>({timeAgo(detail.lastSeenAt)})</span>
        </dd>
      </dl>

      <ContractSection
        fqn={detail.fqn}
        contract={detail.contract}
        shown={shown}
        missingVersion={missing}
        basePath="/event-contracts"
        runsLabel="events"
        intro={
          <>
            A RequestScript script that runs with each event it consumes, reading the event&apos;s fields as its parameters. Events run
            the latest version, and every version&apos;s source is public.
          </>
        }
      />

      <p className={styles.back}>
        <Link href={detail.consumes.known ? `/events/${encodeURIComponent(detail.consumes.fqn)}` : '/events'}>cd ..</Link>
      </p>
    </>
  );
}
