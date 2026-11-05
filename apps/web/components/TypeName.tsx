import Link from 'next/link';
import { structHref, structType } from '@/lib/format';
import styles from './TypeName.module.css';

/**
 * A RequestScript type string. A struct type links to that version of the struct, whether or not the registry
 * has seen it, since a node may name a struct of an organization the registry doesn't read.
 */
export function TypeName({ type, className }: { type: string; className?: string }) {
  const struct = structType(type);
  if (!struct) return <span className={className}>{type}</span>;
  return (
    <span className={className}>
      {struct.lists}
      <Link href={structHref(struct.fqn, struct.version)} className={styles.struct} title={`struct ${struct.fqn}@${struct.version}`}>
        {struct.fqn}@{struct.version}
      </Link>
    </span>
  );
}

/** `(name: type, …)`, as a declaration lists its fields, with struct types linked. Nothing for no fields. */
export function FieldList({ fields, className }: { fields: { name: string; type: string }[]; className?: string }) {
  if (fields.length === 0) return null;
  return (
    <span className={className}>
      (
      {fields.map((field, index) => (
        <span key={field.name}>
          {index > 0 && ', '}
          {field.name}: <TypeName type={field.type} />
        </span>
      ))}
      )
    </span>
  );
}
