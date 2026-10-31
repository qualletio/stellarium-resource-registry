import { isContractManifest, isInferenceManifest, type NodeInfo, type PaymentManifest, type ResourceFunction } from '@registry/types';
import { capabilityExample, formatMicroUsd, formatUsd, requestScriptExample } from '@/lib/format';
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

function Price({ manifest }: { manifest: PaymentManifest | null }) {
  if (!manifest) return <span className={styles.muted}>free: no paymentManifest</span>;
  if (isContractManifest(manifest)) {
    return (
      <>
        <span className={styles.amber}>{formatUsd(manifest.priceMicroUsdPerMillionTokens)}</span>{' '}
        <span className={styles.muted}>per 1M script tokens executed, plus the paid calls it makes</span>
      </>
    );
  }
  if (isInferenceManifest(manifest)) {
    return (
      <>
        <span className={styles.amber}>{formatUsd(manifest.inputCostMicroUsdPerMillionTokens)}</span>{' '}
        <span className={styles.muted}>per 1M input tokens</span> ·{' '}
        <span className={styles.amber}>{formatUsd(manifest.outputCostMicroUsdPerMillionTokens)}</span>{' '}
        <span className={styles.muted}>per 1M output tokens</span>
      </>
    );
  }
  return (
    <>
      <span className={styles.amber}>{formatUsd(manifest.costMicroUsd)}</span>{' '}
      <span className={styles.muted}>({formatMicroUsd(manifest.costMicroUsd)}) per call</span>
    </>
  );
}

function PaymentNote({ manifest }: { manifest: PaymentManifest }) {
  if (isContractManifest(manifest)) {
    return (
      <p className={styles.note}>
        Your node signs a contract voucher for the call, with this price and <code>maxAmount</code>, its{' '}
        <code>CONTRACT_COST_LIMIT_MICRO_USD</code>. The operator holds <code>maxAmount</code> on your organization's balance. The
        contract's own paid calls draw on that hold, and afterwards the host charges the script tokens the contract executed. What's
        left of the hold is released. A call that fails is still charged for its tokens.
      </p>
    );
  }
  if (isInferenceManifest(manifest)) {
    return (
      <p className={styles.note}>
        Your node first asks the host for an estimate: the input tokens, and <code>maxAmount</code>, the charge for those plus{' '}
        <code>maxTokens</code> output tokens. It signs an inference voucher for <code>maxAmount</code> if that is within its{' '}
        <code>INFERENCE_COST_LIMIT_MICRO_USD</code>. The operator holds <code>maxAmount</code> on your organization's balance, then
        charges the tokens the call actually used at these rates: 80% to the recipient organization, 20% platform fee.
      </p>
    );
  }
  return (
    <p className={styles.note}>
      Your node signs a payment voucher for {formatUsd(manifest.costMicroUsd)} with each call. The operator holds it on your
      organization's balance and charges it once the call succeeds: 80% to the recipient organization, 20% platform fee.
    </p>
  );
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
          {fn.kind === 'inference' && <span className={styles.badgeInference}>inference</span>}
          {fn.kind === 'contract' && <span className={styles.badgeContract}>contract</span>}
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
        {fn.kind === 'inference' && (
          <>
            <dt>kind</dt>
            <dd>
              <span className={styles.cyan}>inference</span>
              <span className={styles.muted}>: runs AI inference; maxTokens caps the output tokens</span>
            </dd>
          </>
        )}
        {fn.kind === 'contract' && (
          <>
            <dt>kind</dt>
            <dd>
              <span className={styles.violet}>contract</span>
              <span className={styles.muted}>: runs the contract&apos;s latest version on its host</span>
            </dd>
          </>
        )}
        <dt>price</dt>
        <dd>
          <Price manifest={fn.paymentManifest} />
        </dd>
        {fn.paymentManifest && (
          <>
            <dt>recipient</dt>
            <dd className={styles.copyRow}>
              <code className={styles.address}>{fn.paymentManifest.recipientOrganizationId}</code>
              <CopyButton value={fn.paymentManifest.recipientOrganizationId} />
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
        {fn.paymentManifest && <PaymentNote manifest={fn.paymentManifest} />}
      </details>
    </article>
  );
}
