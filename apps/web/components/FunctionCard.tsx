import type { NodeInfo, ResourceFunction } from '@registry/types';
import { capabilityExample, formatMicroUsdc, formatUsdc, requestScriptExample } from '@/lib/format';
import { CopyButton } from './CopyButton';
import styles from './FunctionCard.module.css';

interface Props {
  path: string;
  name: string;
  fn: ResourceFunction;
  host: NodeInfo | null;
}

function GrantStatus({ host }: { host: NodeInfo | null }) {
  if (!host || host.acceptsGrantRequests === null) {
    return <span className={styles.muted}>unknown: the host hasn&apos;t been probed yet</span>;
  }
  if (!host.acceptsGrantRequests) {
    return <span className={styles.danger}>closed: the host issues grants out of band only</span>;
  }
  return <span className={styles.ok}>open: the host issues grants on request</span>;
}

export function FunctionCard({ path, name, fn, host }: Props) {
  const script = requestScriptExample(path, name, fn);
  const capability = capabilityExample(path, name, fn);
  const describedParameters = fn.parameters.filter((parameter) => parameter.description);

  return (
    <article className={styles.card} id={fn.name}>
      <header className={styles.head}>
        <h3 className={styles.signature}>
          <a href={`#${fn.name}`} className={styles.anchor} aria-label={`Link to ${fn.name}`}>
            #
          </a>
          <span className={styles.fnName}>{fn.name}</span>
          <span className={styles.punct}>(</span>
          {fn.parameters.map((parameter, index) => (
            <span key={parameter.name}>
              {index > 0 && <span className={styles.punct}>, </span>}
              <span className={styles.param}>{parameter.name}</span>
              <span className={styles.punct}>: </span>
              <span className={styles.type}>{parameter.type}</span>
            </span>
          ))}
          <span className={styles.punct}>): </span>
          <span className={styles.type}>{fn.returnType}</span>
        </h3>
        <div className={styles.badges}>
          <span className={fn.paymentManifest ? styles.badgePaid : styles.badgeFree}>{fn.paymentManifest ? 'paid' : 'free'}</span>
          <span className={fn.restricted ? styles.badgeRestricted : styles.badgeOpen}>{fn.restricted ? 'restricted' : 'open'}</span>
        </div>
      </header>

      {fn.description && <p className={styles.description}>{fn.description}</p>}

      <dl className={styles.fields}>
        {describedParameters.length > 0 && (
          <>
            <dt>params</dt>
            <dd>
              <ul className={styles.params}>
                {describedParameters.map((parameter) => (
                  <li key={parameter.name}>
                    <span className={styles.param}>{parameter.name}</span>
                    <span className={styles.punct}> — </span>
                    {parameter.description}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt>price</dt>
        <dd>
          {fn.paymentManifest ? (
            <>
              <span className={styles.amber}>{formatUsdc(fn.paymentManifest.costMicroUsdc)}</span>{' '}
              <span className={styles.muted}>({formatMicroUsdc(fn.paymentManifest.costMicroUsdc)}) per call</span>
            </>
          ) : (
            <span className={styles.muted}>free: no paymentManifest</span>
          )}
        </dd>
        {fn.paymentManifest && (
          <>
            <dt>recipient</dt>
            <dd className={styles.copyRow}>
              <code className={styles.address}>{fn.paymentManifest.recipientAddress}</code>
              <CopyButton value={fn.paymentManifest.recipientAddress} />
            </dd>
          </>
        )}
        <dt>access</dt>
        <dd>
          {fn.restricted ? (
            <span className={styles.danger}>restricted: callers need a grant chain rooted at the host</span>
          ) : (
            <span className={styles.ok}>open: anyone can call it</span>
          )}
        </dd>
        {fn.restricted && (
          <>
            <dt>grants</dt>
            <dd>
              <GrantStatus host={host} />
            </dd>
          </>
        )}
      </dl>

      <details className={styles.details}>
        <summary>
          <span className={styles.summaryLabel}>usage</span>
        </summary>
        <div className={styles.block}>
          <div className={styles.blockHead}>
            <span>requestscript</span>
            <CopyButton value={script} />
          </div>
          <pre className={styles.code}>{script}</pre>
        </div>
        {fn.restricted && (
          <div className={styles.block}>
            <div className={styles.blockHead}>
              <span>capability.json: what a grant for this function covers</span>
              <CopyButton value={capability} />
            </div>
            <pre className={styles.code}>{capability}</pre>
          </div>
        )}
        {fn.paymentManifest && (
          <p className={styles.note}>
            Your node signs a payment voucher for {formatUsdc(fn.paymentManifest.costMicroUsdc)} with each call. The operator settles it
            from your escrow: 80% to the recipient, 20% protocol fee.
          </p>
        )}
      </details>
    </article>
  );
}
