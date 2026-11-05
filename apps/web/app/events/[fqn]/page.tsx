import type { EventTypeDetail } from '@registry/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import contract from '@/components/ContractSection.module.css';
import { CopyButton } from '@/components/CopyButton';
import styles from '@/components/Detail.module.css';
import { SourceCode } from '@/components/SourceCode';
import terminal from '@/components/Terminal.module.css';
import { FieldList } from '@/components/TypeName';
import { getEventType } from '@/lib/api';
import { eventDeclaration, eventFields, formatDate, timeAgo } from '@/lib/format';
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

const versionHref = (event: EventTypeDetail, version: string) =>
  `/events/${encodeURIComponent(event.fqn)}${version === event.latestVersion ? '' : `?version=${encodeURIComponent(version)}`}#declaration`;

function summarize(event: EventTypeDetail): string {
  const latest = event.versions[0];
  const consumers = `${event.consumers.length} event contract${event.consumers.length === 1 ? '' : 's'} consume${event.consumers.length === 1 ? 's' : ''} it`;
  return `${event.fqn} is a Stellarium event type${latest.restricted ? ', restricted to its owner\'s contracts' : ''}. Its events carry ${latest.fields.length === 0 ? 'no fields' : eventFields(latest.fields)}; ${consumers}.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const fqn = await fqnFrom(params);
  const event = await getEventType(fqn);
  if (!event) return { title: fqn };
  return {
    ...pageMetadata({ title: event.fqn, description: event.versions[0].description ?? summarize(event), path: `/events/${encodeURIComponent(event.fqn)}` }),
    ...(event.removedAt && { robots: { index: false, follow: true } }),
  };
}

export default async function EventPage({ params, searchParams }: Props) {
  const event = await getEventType(await fqnFrom(params));
  if (!event) notFound();
  const requested = (await searchParams).version;
  const requestedVersion = Array.isArray(requested) ? requested[0] : requested;
  const latest = event.versions[0];
  const shown = event.versions.find((version) => version.version === requestedVersion) ?? latest;
  const missing = requestedVersion !== undefined && shown.version !== requestedVersion ? requestedVersion : undefined;
  const declaration = eventDeclaration(event.fqn, shown);

  return (
    <>
      <p className={terminal.command}>registry describe {event.fqn}</p>

      {event.removedAt && (
        <p className={styles.removed}>
          warning: the node that declared {event.fqn} no longer lists it. It was last listed {timeAgo(event.lastSeenAt)}.
        </p>
      )}

      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.path}>{event.path}.</span>
          <span className={styles.name}>{event.name}</span>
          <span className={styles.version}>@{event.latestVersion}</span>
        </h1>
        <span className={styles.eventBadge}>event</span>
        {latest.restricted && <span className={styles.restrictedBadge}>restricted</span>}
        <CopyButton value={event.fqn} label="copy fqn" />
      </header>

      {latest.description && <p className={styles.description}>{latest.description}</p>}

      <dl className={styles.meta}>
        <dt>fields</dt>
        <dd>{latest.fields.length === 0 ? <span className={styles.muted}>none</span> : <code><FieldList fields={latest.fields} /></code>}</dd>
        <dt>owner</dt>
        <dd>
          <code>{event.ownerOrganizationId}</code> <span className={styles.muted}>· the only organization whose scripts may emit it</span>
        </dd>
        <dt>consumers</dt>
        <dd>
          {latest.restricted ? (
            <span className={styles.danger}>restricted: delivered only to event contracts its owner deployed</span>
          ) : (
            <span className={styles.ok}>open: any contract on any node may consume it</span>
          )}
        </dd>
        <dt>declared on</dt>
        <dd>
          {event.host?.name && event.host.name !== event.baseUrl ? `${event.host.name} · ` : ''}
          <code>{event.baseUrl}</code>
        </dd>
        <dt>first seen</dt>
        <dd>{formatDate(event.firstSeenAt)}</dd>
        <dt>last seen</dt>
        <dd>
          {formatDate(event.lastSeenAt)} <span className={styles.muted}>({timeAgo(event.lastSeenAt)})</span>
        </dd>
      </dl>

      <section className={terminal.section}>
        <h2 className={terminal.rule}>event contracts ({event.consumers.length})</h2>
        {event.consumers.length === 0 ? (
          <p className={terminal.muted}>No event contracts consume {event.fqn} yet.</p>
        ) : (
          <ol className={contract.versions}>
            {event.consumers.map((consumer) => (
              <li key={consumer.fqn}>
                <Link href={`/event-contracts/${encodeURIComponent(consumer.fqn)}`}>{consumer.fqn}</Link>
                {consumer.latestVersion && <span className={contract.version}>@{consumer.latestVersion}</span>}
                <span className={contract.signature}>consumes @{consumer.eventVersion}</span>
                <span className={contract.deployed}>
                  {consumer.ownerOrganizationId ? <code>{consumer.ownerOrganizationId}</code> : 'unknown owner'} · {consumer.baseUrl}
                </span>
                {consumer.description && <span className={contract.versionDescription}>{consumer.description}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={terminal.section}>
        <h2 className={terminal.rule}>declaration</h2>
        <p className={contract.intro}>
          Versions are immutable. An event contract consumes the version it names, or the latest one its node knows when it is deployed.
        </p>
        <h3 className={contract.subhead}>versions ({event.versions.length})</h3>
        <ol className={contract.versions}>
          {event.versions.map((version) => {
            const current = version.version === shown.version;
            return (
              <li key={version.version} className={current ? contract.current : undefined}>
                <Link href={versionHref(event, version.version)} className={contract.versionLink} aria-current={current ? 'true' : undefined} scroll={false}>
                  @{version.version}
                </Link>
                <span className={contract.signature}>
                  <FieldList fields={version.fields} />
                  {version.restricted && ' restricted'}
                </span>
                <span className={contract.deployed} title={version.declaredAt}>
                  {formatDate(version.declaredAt)}
                </span>
                {version.version === event.latestVersion && <span className={contract.latestBadge}>latest</span>}
                {version.description && <span className={contract.versionDescription}>{version.description}</span>}
              </li>
            );
          })}
        </ol>

        {missing && <p className={terminal.error}>registry: {event.fqn} has no version @{missing}. Showing the latest.</p>}

        <div className={contract.block} id="declaration">
          <div className={contract.blockHead}>
            <span>
              {event.fqn}@{shown.version}
              {shown.version !== event.latestVersion && <span className={contract.old}> · not the latest version</span>}
            </span>
            <CopyButton value={declaration} label="copy declaration" />
          </div>
          <SourceCode source={declaration} />
        </div>
      </section>

      <p className={styles.back}>
        <Link href="/events">cd ..</Link>
      </p>
    </>
  );
}
