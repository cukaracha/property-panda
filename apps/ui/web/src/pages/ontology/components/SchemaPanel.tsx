import { useMemo } from 'react';
import DataTable, { type Column } from '../../../components/tables/DataTable';
import RoleBadge from './RoleBadge';
import type { Schema, SchemaPredicate, SchemaType } from '../types/ontology';

interface SchemaPanelProps {
  schema: Schema;
  typeColors: Map<string, string>;
}

/** The consolidated schema: canonical types (with a role and a human label) and
 *  canonical predicates (with domain, range, and a label). This is the corpus
 *  vocabulary, not instances. */
export default function SchemaPanel({ schema, typeColors }: SchemaPanelProps) {
  // Domain/range cells carry bare machine type names — map them to human labels.
  const typeLabel = useMemo(
    () => new Map(schema.types.map(type => [type.n, type.label || type.n])),
    [schema.types]
  );

  const typeColumns: Column<SchemaType>[] = [
    {
      key: 'n',
      header: 'Type',
      render: type => (
        <span className='flex items-center gap-2'>
          <span
            className='mt-1 inline-block h-2.5 w-2.5 shrink-0 self-start rounded-full'
            style={{ backgroundColor: typeColors.get(type.n) || 'var(--ink-4)' }}
          />
          <span className='min-w-0'>
            <span className='text-ink-2'>{type.label || type.n}</span>{' '}
            <span className='font-mono text-xs text-ink-3'>{type.n}</span>
            {!type.semantic && <span className='ml-1 text-xs text-ink-4'>scaffolding</span>}
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: type => <RoleBadge role={type.role} />,
    },
    {
      key: 'def',
      header: 'Definition',
      render: type => <span className='text-ink-3'>{type.def}</span>,
    },
  ];

  const predColumns: Column<SchemaPredicate>[] = [
    {
      key: 'n',
      header: 'Predicate',
      render: pred => (
        <span className='min-w-0'>
          <span className='text-ink-2'>{pred.label || pred.n}</span>{' '}
          <span className='font-mono text-xs text-ink-3'>{pred.n}</span>
        </span>
      ),
    },
    {
      key: 'domrng',
      header: 'Domain to range',
      render: pred => (
        <span className='text-ink-3'>
          {(pred.dom ?? []).map(d => typeLabel.get(d) ?? d).join(', ') || 'any'} to{' '}
          {(pred.rng ?? []).map(r => typeLabel.get(r) ?? r).join(', ') || 'any'}
        </span>
      ),
    },
    {
      key: 'def',
      header: 'Definition',
      render: pred => <span className='text-ink-3'>{pred.def}</span>,
    },
  ];

  return (
    <div className='mx-auto flex max-w-[1080px] flex-col gap-[26px] px-5 pb-14 pt-[18px]'>
      <div>
        <div className='type-ui-eyebrow text-ink-4'>Types ({schema.types.length})</div>
        <p className='mb-2 mt-1 text-xs text-ink-4'>
          The vocabulary the pipeline settled on for this corpus
        </p>
        <DataTable
          columns={typeColumns}
          data={schema.types}
          keyExtractor={type => type.n}
          emptyMessage='No types were consolidated.'
        />
      </div>
      <div>
        <div className='type-ui-eyebrow text-ink-4'>Predicates ({schema.predicates.length})</div>
        <p className='mb-2 mt-1 text-xs text-ink-4'>How those types are allowed to relate</p>
        <DataTable
          columns={predColumns}
          data={schema.predicates}
          keyExtractor={pred => pred.n}
          emptyMessage='No predicates were consolidated.'
        />
      </div>
    </div>
  );
}
