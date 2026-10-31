import type { ContractInfo, ContractVersion } from '@registry/types';
import Link from 'next/link';
import { formatDate, timeAgo } from '@/lib/format';
import { CopyButton } from './CopyButton';
import styles from './ContractSection.module.css';
import { SourceCode } from './SourceCode';
import terminal from './Terminal.module.css';

interface Props {
  fqn: string;
  contract: ContractInfo;
  /** The version whose source to show. */
  shown: Pick<ContractVersion, 'version' | 'source'> | null;
  /** A `?version=` that matched none, to say so. */
  missingVersion?: string;
}

const versionHref = (fqn: string, version: string, latest: string | null) =>
  `/resources/${encodeURIComponent(fqn)}${version === latest ? '' : `?version=${encodeURIComponent(version)}`}#source`;

/** A contract's deployed versions, newest first, and one version's RequestScript source. */
export function ContractSection({ fqn, contract, shown, missingVersion }: Props) {
  return (
    <section className={terminal.section}>
      <h2 className={terminal.rule}>contract</h2>
      <p className={styles.intro}>
        A RequestScript script deployed to its host. Calls run the latest version, and every version&apos;s source is public, so you
        can read what a call does before you make it.
      </p>

      <dl className={styles.meta}>
        <dt>latest</dt>
        <dd>{contract.latestVersion ? <span className={styles.version}>@{contract.latestVersion}</span> : <span className={styles.muted}>unknown</span>}</dd>
        <dt>owner</dt>
        <dd>
          {contract.ownerOrganizationId ? (
            <code className={styles.owner}>{contract.ownerOrganizationId}</code>
          ) : contract.versions.length > 0 ? (
            <span className={styles.muted}>the host node&apos;s admin</span>
          ) : (
            <span className={styles.muted}>unknown</span>
          )}
        </dd>
        <dt>source read</dt>
        <dd>
          {contract.syncedAt ? (
            <>
              {formatDate(contract.syncedAt)} <span className={styles.muted}>({timeAgo(contract.syncedAt)})</span>
            </>
          ) : (
            <span className={styles.muted}>not yet: the registry hasn&apos;t reached the host</span>
          )}
        </dd>
      </dl>

      {contract.versions.length === 0 ? (
        <p className={terminal.muted}>
          {contract.syncedAt ? 'The host lists no versions of this contract.' : 'Versions and source appear once the registry reads them from the host.'}
        </p>
      ) : (
        <>
          <h3 className={styles.subhead}>versions ({contract.versions.length})</h3>
          <ol className={styles.versions}>
            {contract.versions.map((version) => {
              const current = version.version === shown?.version;
              return (
                <li key={version.version} className={current ? styles.current : undefined}>
                  <Link href={versionHref(fqn, version.version, contract.latestVersion)} className={styles.versionLink} aria-current={current ? 'true' : undefined} scroll={false}>
                    @{version.version}
                  </Link>
                  <span className={styles.signature}>
                    ({version.parameters.map((parameter) => `${parameter.name}: ${parameter.type}`).join(', ')}): {version.returnType}
                  </span>
                  <span className={styles.deployed} title={version.deployedAt}>
                    {formatDate(version.deployedAt)}
                  </span>
                  {version.version === contract.latestVersion && <span className={styles.latestBadge}>latest</span>}
                  {version.description && <span className={styles.versionDescription}>{version.description}</span>}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {missingVersion && <p className={terminal.error}>registry: {fqn} has no version @{missingVersion}. Showing the latest.</p>}

      {shown && (
        <div className={styles.block} id="source">
          <div className={styles.blockHead}>
            <span>
              {fqn}@{shown.version}
              {shown.version !== contract.latestVersion && <span className={styles.old}> · not the version calls run</span>}
            </span>
            <CopyButton value={shown.source} label="copy source" />
          </div>
          <SourceCode source={shown.source} />
        </div>
      )}
    </section>
  );
}
