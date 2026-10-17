import Link from 'next/link';
import terminal from '@/components/Terminal.module.css';

export default function NotFound() {
  return (
    <>
      <p className={terminal.command}>registry describe</p>
      <p className={terminal.error}>bash: resource not found: the registry has never seen this path</p>
      <p>
        <Link href="/search">try ./search</Link> <span className={terminal.muted}>or</span> <Link href="/">cd ~</Link>
      </p>
    </>
  );
}
