'use client';

import { SEARCH_FIELDS, type SearchField } from '@registry/types';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from './SearchPrompt.module.css';

export interface SearchState {
  q: string;
  in: SearchField;
  paid: boolean;
  restricted: boolean;
  inference: boolean;
  contract: boolean;
}

interface Props {
  initial: SearchState;
  /** Update /search as the user types. Off on the home page, where Enter searches. */
  live?: boolean;
  autoFocus?: boolean;
}

const DEBOUNCE_MS = 250;

function urlFor(state: SearchState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.in !== 'all') params.set('in', state.in);
  if (state.paid) params.set('paid', 'true');
  if (state.restricted) params.set('restricted', 'true');
  if (state.inference) params.set('inference', 'true');
  if (state.contract) params.set('contract', 'true');
  const query = params.toString();
  return query ? `/search?${query}` : '/search';
}

/**
 * The search box and its filters. A plain GET form to /search, so it works without JavaScript;
 * with it, results update as you type and `/` focuses the box from anywhere on the page.
 */
export function SearchPrompt({ initial, live = false, autoFocus = false }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (next: SearchState, debounce: boolean) => {
    setState(next);
    if (!live) return;
    clearTimeout(timer.current);
    const navigate = () => router.replace(urlFor(next), { scroll: false });
    if (debounce) timer.current = setTimeout(navigate, DEBOUNCE_MS);
    else navigate();
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    clearTimeout(timer.current);
    router.push(urlFor(state));
  };

  return (
    <search>
      <form className={styles.form} action="/search" method="get" onSubmit={onSubmit}>
        <label className={styles.prompt}>
          <span className={styles.ps1} aria-hidden="true">
            $ search
          </span>
          <span className={styles.visuallyHidden}>Search resources</span>
          <input
            ref={input}
            className={styles.input}
            type="search"
            name="q"
            value={state.q}
            onChange={(event) => update({ ...state, q: event.target.value }, true)}
            placeholder="path, name or function…"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            // biome-ignore lint/a11y/noAutofocus: the home page exists to search
            autoFocus={autoFocus}
          />
          <kbd className={styles.kbd} title="Press / to focus">/</kbd>
        </label>

        <div className={styles.filters}>
          <fieldset className={styles.group}>
            <legend className={styles.legend}>--in</legend>
            {SEARCH_FIELDS.map((field) => (
              <label key={field} className={styles.chip}>
                <input
                  type="radio"
                  name="in"
                  value={field}
                  checked={state.in === field}
                  onChange={() => update({ ...state, in: field }, false)}
                />
                <span>{field}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className={styles.group}>
            <legend className={styles.legend}>flags</legend>
            <label className={styles.chip}>
              <input
                type="checkbox"
                name="paid"
                value="true"
                checked={state.paid}
                onChange={(event) => update({ ...state, paid: event.target.checked }, false)}
              />
              <span>--paid</span>
            </label>
            <label className={styles.chip}>
              <input
                type="checkbox"
                name="restricted"
                value="true"
                checked={state.restricted}
                onChange={(event) => update({ ...state, restricted: event.target.checked }, false)}
              />
              <span>--restricted</span>
            </label>
            <label className={styles.chip}>
              <input
                type="checkbox"
                name="inference"
                value="true"
                checked={state.inference}
                onChange={(event) => update({ ...state, inference: event.target.checked }, false)}
              />
              <span>--inference</span>
            </label>
            <label className={styles.chip}>
              <input
                type="checkbox"
                name="contract"
                value="true"
                checked={state.contract}
                onChange={(event) => update({ ...state, contract: event.target.checked }, false)}
              />
              <span>--contract</span>
            </label>
          </fieldset>
          {!live && (
            <button type="submit" className={styles.submit}>
              [ enter ]
            </button>
          )}
        </div>
      </form>
    </search>
  );
}
