'use client';

import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import styles from './ThemeToggle.module.css';

type Theme = 'dark' | 'light';

export function ThemeToggle() {
  // Unknown until mounted: the server can't know which theme the bootstrap script picked.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  const choose = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies to this page.
    }
    setTheme(next);
  };

  return (
    <fieldset className={styles.toggle}>
      <legend className={styles.legend}>Color theme</legend>
      <span className={styles.bracket}>[</span>
      {(['dark', 'light'] as const).map((option, index) => (
        <span key={option} className={styles.item}>
          {index > 0 && <span className={styles.pipe}>|</span>}
          <button
            type="button"
            className={styles.option}
            aria-pressed={theme === option}
            onClick={() => choose(option)}
          >
            {option}
          </button>
        </span>
      ))}
      <span className={styles.bracket}>]</span>
    </fieldset>
  );
}
