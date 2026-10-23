import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Hide from the stacked mobile view (e.g. a column already shown as the card title). */
  hideOnMobile?: boolean;
  className?: string;
}

interface TableProps<T> {
  /** Describes the table for screen readers (rendered visually hidden). */
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Optional title for each stacked card on small screens. */
  mobileTitle?: (row: T) => ReactNode;
}

/**
 * A real <table> on medium screens and up; on small screens the same rows become a list of
 * cards with "label: value" pairs, so nothing needs horizontal scrolling.
 */
export function Table<T>({ caption, columns, rows, rowKey, mobileTitle }: TableProps<T>) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-5 py-3 text-2xs font-semibold uppercase text-ink-subtle",
                    column.align === "right" && "text-right",
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line-soft last:border-0 hover:bg-page/60">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn("px-5 py-3.5 align-middle text-ink", column.align === "right" && "text-right tabular-nums", column.className)}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line-soft md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="space-y-2 px-4 py-4">
            {mobileTitle && <div className="font-medium text-ink">{mobileTitle(row)}</div>}
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
              {columns.filter((column) => !column.hideOnMobile).map((column) => (
                <div key={column.key} className="contents">
                  <dt className="text-ink-subtle">{column.header}</dt>
                  <dd className="text-right text-ink">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
