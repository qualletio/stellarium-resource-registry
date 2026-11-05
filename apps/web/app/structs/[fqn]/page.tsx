import type { StructDetail, StructUse } from '@registry/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import contract from '@/components/ContractSection.module.css';
import { CopyButton } from '@/components/CopyButton';
import styles from '@/components/Detail.module.css';
import { SourceCode } from '@/components/SourceCode';
import terminal from '@/components/Terminal.module.css';
import { FieldList } from '@/components/TypeName';
import { getStruct } from '@/lib/api';
import { eventFields, formatDate, structDeclaration, structExample, structHref, timeAgo } from '@/lib/format';
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

const versionHref = (struct: StructDetail, version: string) => `${structHref(struct.fqn, version === struct.latestVersion ? undefined : version)}#declaration`;

function summarize(struct: StructDetail): string {
  const latest = struct.versions[0];
  const uses = `${struct.usedBy.length} ${struct.usedBy.length === 1 ? 'type names' : 'types name'} it`;
  return `${struct.fqn} is a Stellarium struct owned by ${struct.ownerOrganizationId}, with fields ${eventFields(latest.fields) || '()'}; ${uses}.`;
}

const KIND_LABELS: Record<StructUse['kind'], string> = {
  function: 'function',
  contract: 'contract',
  event: 'event',
  eventContract: 'event contract',
  struct: 'struct',
};

/** Where the use is, and its page. */
function describeUse(use: StructUse): { href: string; label: string; where: string } {
  const at = (version: string | null) => (version ? `@${version}` : '');
  const query = (version: string | null) => (version ? `?version=${encodeURIComponent(version)}` : '');
  const fqn = encodeURIComponent(use.fqn);
  switch (use.kind) {
    case 'function':
      return {
        href: `/resources/${fqn}#${encodeURIComponent(use.function ?? '')}`,
        label: `${use.fqn}.${use.function}`,
        where: use.role === 'returns' ? 'returns it' : `parameter ${use.member}`,
      };
    case 'contract':
      return { href: `/resources/${fqn}${query(use.version)}#source`, label: `${use.fqn}${at(use.version)}`, where: 'in its source' };
    case 'eventContract':
      return { href: `/event-contracts/${fqn}${query(use.version)}#source`, label: `${use.fqn}${at(use.version)}`, where: 'in its source' };
    case 'event':
      return { href: `/events/${fqn}${query(use.version)}#declaration`, label: `${use.fqn}${at(use.version)}`, where: `field ${use.member}` };
    case 'struct':
      return { href: `${structHref(use.fqn, use.version ?? undefined)}#declaration`, label: `${use.fqn}${at(use.version)}`, where: `field ${use.member}` };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const fqn = await fqnFrom(params);
  const struct = await getStruct(fqn);
  if (!struct) return { title: fqn };
  return {
    ...pageMetadata({ title: struct.fqn, description: struct.versions[0].description ?? summarize(struct), path: structHref(struct.fqn) }),
    ...(struct.removedAt && { robots: { index: false, follow: true } }),
  };
}

export default async function StructPage({ params, searchParams }: Props) {
  const struct = await getStruct(await fqnFrom(params));
  if (!struct) notFound();
  const requested = (await searchParams).version;
  const requestedVersion = Array.isArray(requested) ? requested[0] : requested;
  const latest = struct.versions[0];
  const shown = struct.versions.find((version) => version.version === requestedVersion) ?? latest;
  const missing = requestedVersion !== undefined && shown.version !== requestedVersion ? requestedVersion : undefined;
  const declaration = structDeclaration(struct.fqn, shown.version, shown.fields);
  const example = structExample(struct.name, struct.fqn, shown.version, shown.fields);
  const typeString = `${struct.fqn}@${shown.version}`;

  return (
    <>
      <p className={terminal.command}>registry describe {struct.fqn}</p>

      {struct.removedAt && (
        <p className={styles.removed}>
          warning: no node the registry reads lists {struct.fqn} any more. It was last listed {timeAgo(struct.lastSeenAt)}. Its versions
          never change, so what names them still means the fields below.
        </p>
      )}

      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.path}>{struct.path}.</span>
          <span className={styles.name}>{struct.name}</span>
          <span className={styles.version}>@{struct.latestVersion}</span>
        </h1>
        <span className={styles.structBadge}>struct</span>
        <CopyButton value={struct.fqn} label="copy fqn" />
      </header>

      {latest.description && <p className={styles.description}>{latest.description}</p>}

      <dl className={styles.meta}>
        <dt>fields</dt>
        <dd>{latest.fields.length === 0 ? <span className={styles.muted}>none</span> : <code><FieldList fields={latest.fields} /></code>}</dd>
        <dt>owner</dt>
        <dd>
          <code>{struct.ownerOrganizationId}</code> <span className={styles.muted}>· the only organization whose nodes may declare versions of it</span>
        </dd>
        <dt>declared on</dt>
        <dd>
          <code>{latest.baseUrl}</code>
        </dd>
        <dt>first seen</dt>
        <dd>{formatDate(struct.firstSeenAt)}</dd>
        <dt>last seen</dt>
        <dd>
          {formatDate(struct.lastSeenAt)} <span className={styles.muted}>({timeAgo(struct.lastSeenAt)})</span>
        </dd>
      </dl>

      <section className={terminal.section}>
        <h2 className={terminal.rule}>used by ({struct.usedBy.length})</h2>
        {struct.usedBy.length === 0 ? (
          <p className={terminal.muted}>Nothing in the registry names {struct.fqn} yet.</p>
        ) : (
          <ol className={contract.versions}>
            {struct.usedBy.map((use) => {
              const { href, label, where } = describeUse(use);
              return (
                <li key={`${use.kind} ${use.fqn} ${use.version} ${use.function} ${use.member} ${use.role} ${use.structVersion}`}>
                  <span className={styles.useKind}>{KIND_LABELS[use.kind]}</span>
                  <Link href={href}>{label}</Link>
                  <span className={contract.signature}>{where}</span>
                  <Link href={versionHref(struct, use.structVersion)} className={contract.version} scroll={false}>
                    names @{use.structVersion}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className={terminal.section}>
        <h2 className={terminal.rule}>declaration</h2>
        <p className={contract.intro}>
          Versions are immutable and never deleted, and every type names the version it means, so declaring a new version changes
          nothing that names an older one. Values are checked structurally: any object whose fields fit is accepted, a missing field is
          null, and extra fields are kept.
        </p>
        <h3 className={contract.subhead}>versions ({struct.versions.length})</h3>
        <ol className={contract.versions}>
          {struct.versions.map((version) => {
            const current = version.version === shown.version;
            return (
              <li key={version.version} className={current ? contract.current : undefined}>
                <Link href={versionHref(struct, version.version)} className={contract.versionLink} aria-current={current ? 'true' : undefined} scroll={false}>
                  @{version.version}
                </Link>
                <span className={contract.signature}>
                  <FieldList fields={version.fields} />
                </span>
                <span className={contract.deployed} title={version.declaredAt}>
                  {formatDate(version.declaredAt)}
                </span>
                {version.version === struct.latestVersion && <span className={contract.latestBadge}>latest</span>}
                {version.description && <span className={contract.versionDescription}>{version.description}</span>}
              </li>
            );
          })}
        </ol>

        {missing && <p className={terminal.error}>registry: {struct.fqn} has no version @{missing}. Showing the latest.</p>}

        <div className={contract.block} id="declaration">
          <div className={contract.blockHead}>
            <span>
              {typeString}
              {shown.version !== struct.latestVersion && <span className={contract.old}> · not the latest version</span>}
              {shown.baseUrl !== latest.baseUrl && <span className={contract.old}> · declared on {shown.baseUrl}</span>}
            </span>
            <CopyButton value={declaration} label="copy declaration" />
          </div>
          <SourceCode source={declaration} />
        </div>

        <h3 className={contract.subhead}>usage</h3>
        <div className={contract.block}>
          <div className={contract.blockHead}>
            <span>requestscript</span>
            <CopyButton value={example} />
          </div>
          <SourceCode source={example} />
        </div>
        <p className={contract.intro}>
          In a TypeScript resource function, use <code>{`'${typeString}'`}</code> as a parameter or return type. The node checks
          struct-typed parameters before anything is paid or run.
        </p>
      </section>

      <p className={styles.back}>
        <Link href="/structs">cd ..</Link>
      </p>
    </>
  );
}
