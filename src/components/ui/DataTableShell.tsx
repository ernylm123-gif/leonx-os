import type { ReactNode } from 'react'

interface DataTableShellProps {
  columns: string[]
  /** Kayıt yokken tablo gövdesinde gösterilecek içerik */
  empty: ReactNode
  caption: string
}

/**
 * Bir veri tablosunun yapısını (sütun başlıkları) gösterir; satır verisi yoktur.
 * Veritabanı bağlandığında satırlar bu kabuğa eklenecek.
 */
export function DataTableShell({ columns, empty, caption }: DataTableShellProps) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-surface-2 text-[11px] tracking-[0.08em] text-muted uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col" className="px-4 py-3 font-semibold whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
