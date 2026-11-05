import styles from './SearchPrompt.module.css';

/** The struct search box: a plain GET form to /structs. Enter searches. */
export function StructSearch({ q, autoFocus = false }: { q: string; autoFocus?: boolean }) {
  return (
    <search>
      <form className={styles.form} action="/structs" method="get">
        <label className={styles.prompt}>
          <span className={styles.ps1} aria-hidden="true">
            $ structs
          </span>
          <span className={styles.visuallyHidden}>Search structs</span>
          <input
            className={styles.input}
            type="search"
            name="q"
            defaultValue={q}
            placeholder="struct or field…"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            // biome-ignore lint/a11y/noAutofocus: the page exists to search
            autoFocus={autoFocus}
          />
        </label>
        <div className={styles.filters}>
          <button type="submit" className={styles.submit}>
            [ enter ]
          </button>
        </div>
      </form>
    </search>
  );
}
