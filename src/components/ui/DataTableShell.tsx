import type { ReactNode } from 'react'

interface DataTableShellProps {
  columns: string[]
  /** Kayıt yokken tablo gövdesinde gösterilecek içerik */
  empty: ReactNode
}

/**
 * Bir veri tablosunun yapısını (sütun başlıkları) gösterir; satır verisi yoktur.
 * Veritabanı bağlandığında satırlar bu kabuğa eklenecek.
 */
export function DataTableShell({ columns, empty }: DataTableShellProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-white/[0.03] text-[11px] tracking-wider text-titanium-400 uppercase">
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
