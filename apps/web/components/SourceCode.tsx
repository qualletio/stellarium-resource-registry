import styles from './SourceCode.module.css';

/** RequestScript's keywords (`KEYWORDS` in requestscript), and `state`, which only follows `var`. */
const KEYWORDS = new Set(['request', 'contract', 'var', 'const', 'return', 'if', 'else', 'state']);
const LITERALS = new Set(['true', 'false', 'null']);
/** Values every contract can read. */
const BUILTINS = new Set(['caller', 'jwt']);
const TYPE = /^(u?int(8|16|32|64)|float(32|64)|string|boolean|bool|decimal|any)$/;

const TOKEN = /(\/\/.*)|("(?:[^"\\]|\\.)*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|.)/g;

type Kind = 'comment' | 'string' | 'number' | 'keyword' | 'literal' | 'builtin' | 'type' | 'plain';

function tokenize(line: string): { text: string; kind: Kind }[] {
  const tokens: { text: string; kind: Kind }[] = [];
  for (const [text, comment, string, number, word] of line.matchAll(TOKEN)) {
    let kind: Kind = 'plain';
    if (comment) kind = 'comment';
    else if (string) kind = 'string';
    else if (number) kind = 'number';
    else if (word) {
      if (KEYWORDS.has(word)) kind = 'keyword';
      else if (LITERALS.has(word)) kind = 'literal';
      else if (BUILTINS.has(word)) kind = 'builtin';
      else if (TYPE.test(word)) kind = 'type';
    }
    // Merge runs of plain text, so a line renders as few elements as it can.
    const last = tokens[tokens.length - 1];
    if (kind === 'plain' && last?.kind === 'plain') last.text += text;
    else tokens.push({ text, kind });
  }
  return tokens;
}

/**
 * RequestScript source with line numbers and light highlighting. The source comes from a remote node,
 * so it is only ever rendered as text.
 */
export function SourceCode({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return (
    <pre className={styles.code}>
      <code>
        {lines.map((line, index) => (
          // Lines have no identity beyond their position.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <span key={index} className={styles.line}>
            {tokenize(line).map((token, at) =>
              token.kind === 'plain' ? (
                token.text
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional too
                <span key={at} className={styles[token.kind]}>
                  {token.text}
                </span>
              ),
            )}
          </span>
        ))}
      </code>
    </pre>
  );
}
