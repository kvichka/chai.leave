import { useMemo, useState, type ReactNode } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Minus,
  Plus,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { TableSkeleton } from './primitives'

/**
 * Optional grouping. The table splits into collapsible sections keyed by
 * `value`, each with a +/- toggle.
 *
 * Grouping turns pagination off. Paging across a group boundary hides part of
 * a section behind a Next button, which reads as "this department has three
 * rows" when it has thirty.
 */
export interface GroupBy<T> {
  /** Section key. Return '' for rows with no value; those sort last. */
  value: (row: T) => string
  /** Shown in place of the '' key. */
  emptyLabel?: string
  /** Right-hand side of the section header - a count, a total, a badge. */
  summary?: (rows: T[]) => ReactNode
}

export function DataTable<T>({
  data,
  columns,
  loading,
  globalFilter,
  onGlobalFilterChange,
  empty,
  pageSize = 25,
  initialSorting = [],
  rowClassName,
  groupBy,
}: {
  data: T[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[]
  loading?: boolean
  globalFilter?: string
  onGlobalFilterChange?: (v: string) => void
  empty: ReactNode
  pageSize?: number
  initialSorting?: SortingState
  rowClassName?: (row: T) => string | undefined
  groupBy?: GroupBy<T>
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  })

  // Filtered and sorted, but deliberately not paginated - see GroupBy above.
  const sortedRows = table.getSortedRowModel().rows
  const rows = groupBy ? sortedRows : table.getRowModel().rows

  const groups = useMemo(() => {
    if (!groupBy) return []
    const map = new Map<string, Row<T>[]>()
    for (const r of sortedRows) {
      const key = groupBy.value(r.original) || ''
      const bucket = map.get(key)
      if (bucket) bucket.push(r)
      else map.set(key, [r])
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([key, groupRows]) => ({ key, rows: groupRows }))
  }, [groupBy, sortedRows])

  if (loading) return <TableSkeleton rows={6} cols={Math.min(columns.length, 6)} />
  if (data.length === 0) return <div className="card">{empty}</div>

  const colCount = table.getVisibleLeafColumns().length
  const pageCount = table.getPageCount()
  // A collapsed section during a search would hide the very rows being looked
  // for, so searching overrides the toggles.
  const searching = Boolean(globalFilter?.trim())
  const isOpen = (key: string) => searching || !collapsed.has(key)
  const allOpen = groups.every((g) => isOpen(g.key))

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-2">
      {groupBy && groups.length > 1 ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCollapsed(allOpen ? new Set(groups.map((g) => g.key)) : new Set())}
            disabled={searching}
            className="rounded px-1.5 py-0.5 text-xs font-medium text-chai-700 hover:bg-chai-50 disabled:opacity-40"
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const sortable = header.column.getCanSort()
                  const dir = header.column.getIsSorted()
                  return (
                    <th key={header.id} scope="col" className="th">
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 rounded hover:text-slate-800"
                          aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {dir === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : dir === 'desc' ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>

          {rows.length === 0 ? (
            <tbody className="bg-white">
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-sm text-slate-500">
                  Nothing matches that filter.
                </td>
              </tr>
            </tbody>
          ) : groupBy ? (
            groups.map((group) => {
              const open = isOpen(group.key)
              const label = group.key || groupBy.emptyLabel || 'Not set'
              return (
                <tbody key={group.key} className="divide-y divide-slate-100 bg-white">
                  <tr className="border-t border-slate-200">
                    <td colSpan={colCount} className="bg-chai-50/70 p-0">
                      <button
                        type="button"
                        onClick={() => toggle(group.key)}
                        disabled={searching}
                        aria-expanded={open}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-chai-50 disabled:cursor-default"
                      >
                        <span
                          aria-hidden
                          className="grid h-4 w-4 shrink-0 place-items-center rounded border border-chai-300 bg-white text-chai-700"
                        >
                          {open ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        </span>
                        <span className="text-xs font-semibold text-chai-800">{label}</span>
                        <span className="ml-auto text-xs font-normal text-slate-500">
                          {groupBy.summary
                            ? groupBy.summary(group.rows.map((r) => r.original))
                            : `${group.rows.length} rows`}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {open
                    ? group.rows.map((row) => (
                        <tr
                          key={row.id}
                          className={cn('hover:bg-slate-50/70', rowClassName?.(row.original))}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="td">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      ))
                    : null}
                </tbody>
              )
            })
          ) : (
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn('hover:bg-slate-50/70', rowClassName?.(row.original))}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="td">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      {!groupBy && pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {pageCount} · {rows.length} of{' '}
            {table.getFilteredRowModel().rows.length} rows
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
