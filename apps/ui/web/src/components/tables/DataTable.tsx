import type { ReactNode } from 'react';

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
}

/** Generic token-styled table: hairline header rule, hover-tinted rows, an
 *  optional trailing actions column, and a centred empty state. */
function DataTable<T>({
  columns,
  data,
  keyExtractor,
  actions,
  emptyMessage = 'No data found.',
}: DataTableProps<T>) {
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
              className='border-b border-line-2 transition-colors hover:bg-panel-2'
            >
              {columns.map(col => (
                <td key={col.key} className='px-4 py-3 text-sm text-ink-2'>
                  {col.render
                    ? col.render(item)
                    : String((item as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
              {actions && (
                <td className='px-4 py-3 text-right'>
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
