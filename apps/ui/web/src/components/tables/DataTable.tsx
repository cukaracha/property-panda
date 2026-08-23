import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  actions?: (item: T) => ReactNode;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  rowLabel?: (item: T) => string;
}

/** Generic token-styled table: hairline header rule, hover-tinted rows, an
 *  optional trailing actions column, and a centred empty state. When
 *  `onRowClick` is set the row becomes the click target, reachable by keyboard,
 *  and the actions cell stops the click from reaching it. */
function DataTable<T>({
  columns,
  data,
  keyExtractor,
  actions,
  emptyMessage = 'No data found.',
  onRowClick,
  rowLabel,
}: DataTableProps<T>) {
  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, item: T) => {
    if (!onRowClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(item);
    }
  };

  if (data.length === 0) {
    return (
      <div className='py-12 text-center text-ink-3'>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className='overflow-x-auto'>
      <table className='w-full'>
        <thead>
          <tr className='border-b border-line'>
            {columns.map(col => (
              <th key={col.key} className='type-ui-eyebrow px-4 py-3 text-left'>
                {col.header}
              </th>
            ))}
            {actions && <th className='type-ui-eyebrow px-4 py-3 text-right'>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {data.map(item => (
            <tr
              key={keyExtractor(item)}
              className={cn(
                'border-b border-line-2 transition-colors hover:bg-panel-2',
                onRowClick &&
                  'cursor-pointer focus-visible:shadow-[var(--ring)] focus-visible:outline-none'
              )}
              role={onRowClick ? 'link' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={onRowClick ? rowLabel?.(item) : undefined}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
              onKeyDown={onRowClick ? event => handleRowKeyDown(event, item) : undefined}
            >
              {columns.map(col => (
                <td key={col.key} className='px-4 py-3 text-sm text-ink-2'>
                  {col.render
                    ? col.render(item)
                    : String((item as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
              {actions && (
                <td
                  className='px-4 py-3 text-right'
                  onClick={onRowClick ? event => event.stopPropagation() : undefined}
                >
                  <div className='flex items-center justify-end gap-1'>{actions(item)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
