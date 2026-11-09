import type { ReactNode } from 'react';
import styles from './DataTable.module.css';

export type Column<Row> = {
  id: string;
  header: ReactNode;
  /** برچسب نسخه‌ی موبایل (هر ردیف به کارت تبدیل می‌شود). پیش‌فرض: خود header. */
  label?: string;
  cell: (row: Row) => ReactNode;
  footer?: ReactNode;
  align?: 'start' | 'end';
  width?: string;
  /** این ستون در نسخه‌ی موبایل بدون برچسب و تمام‌عرض نمایش داده می‌شود (مثلاً دکمه‌ها). */
  bare?: boolean;
};

type DataTableProps<Row> = {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  caption: string;
  empty?: ReactNode;
  footerRow?: boolean;
};

export const DataTable = <Row,>({ columns, rows, rowKey, caption, empty, footerRow }: DataTableProps<Row>) => {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className={column.align === 'end' ? styles.end : undefined} style={{ width: column.width }}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  data-label={column.bare ? undefined : (column.label ?? (typeof column.header === 'string' ? column.header : ''))}
                  className={[column.align === 'end' ? styles.end : '', column.bare ? styles.bare : ''].filter(Boolean).join(' ') || undefined}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footerRow && (
          <tfoot>
            <tr>
              {columns.map((column) => (
                <td key={column.id} data-label={column.label ?? (typeof column.header === 'string' ? column.header : '')} className={column.align === 'end' ? styles.end : undefined}>
                  {column.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};
