import { blockCells } from '@/lib/banner';
import styles from './Banner.module.css';

/** Block-letter lines drawn as SVG cells, so they line up whatever font is loaded. */
export function Banner({ lines, label }: { lines: string[]; label: string }) {
  const rows = lines.flatMap((line, index) => [...(index > 0 ? [[]] : []), ...blockCells(line)]);
  const width = Math.max(...rows.map((row) => row.length));
  // One path of small squares, inset so neighbouring cells read as separate pixels.
  const d = rows.flatMap((row, y) => row.flatMap((filled, x) => (filled ? [`M${x + 0.06} ${y + 0.06}h.88v.88h-.88z`] : []))).join('');
  return (
    <svg className={styles.banner} viewBox={`0 0 ${width} ${rows.length}`} role="img" aria-label={label}>
      <path d={d} />
    </svg>
  );
}
