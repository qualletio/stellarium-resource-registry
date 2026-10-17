'use client';

import { useState } from 'react';
import styles from './CopyButton.module.css';

export function CopyButton({ value, label = 'copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the text is still selectable.
    }
  };

  return (
    <button type="button" className={styles.button} onClick={copy} aria-live="polite">
      [{copied ? 'copied' : label}]
    </button>
  );
}
