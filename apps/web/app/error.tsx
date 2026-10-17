'use client';

import terminal from '@/components/Terminal.module.css';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <p className={terminal.command}>curl $API_URL/v1</p>
      <p className={terminal.error}>error: the registry API could not be reached or returned an error.</p>
      {error.digest && <p className={terminal.muted}>digest: {error.digest}</p>}
      <p>
        <button type="button" onClick={reset} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', cursor: 'pointer' }}>
          [ retry ]
        </button>
      </p>
    </>
  );
}
