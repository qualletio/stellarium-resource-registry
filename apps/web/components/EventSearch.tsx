import styles from './SearchPrompt.module.css';

/** The event search box: a plain GET form to /events. Enter searches. */
export function EventSearch({ q, restricted, autoFocus = false }: { q: string; restricted: boolean; autoFocus?: boolean }) {
  return (
    <search>
      <form className={styles.form} action="/events" method="get">
        <label className={styles.prompt}>
          <span className={styles.ps1} aria-hidden="true">
            $ events
          </span>
          <span className={styles.visuallyHidden}>Search events</span>
          <input
            className={styles.input}
            type="search"
            name="q"
            defaultValue={q}
            placeholder="event, field or event contract…"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            // biome-ignore lint/a11y/noAutofocus: the page exists to search
            autoFocus={autoFocus}
          />
        </label>
        <div className={styles.filters}>
          <fieldset className={styles.group}>
            <legend className={styles.legend}>flags</legend>
            <label className={styles.chip}>
              <input type="checkbox" name="restricted" value="true" defaultChecked={restricted} />
              <span>--restricted</span>
            </label>
          </fieldset>
          <button type="submit" className={styles.submit}>
            [ enter ]
          </button>
        </div>
      </form>
    </search>
  );
}
