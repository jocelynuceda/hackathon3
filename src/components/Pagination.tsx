interface PaginationProps {
  page: number
  totalPages: number
  totalElements: number
  onPage: (page: number) => void
}

export function Pagination({ page, totalPages, totalElements, onPage }: PaginationProps) {
  if (totalPages <= 1) return null
  return (
    <nav className="mt-4 flex items-center gap-3" aria-label="Paginación">
      <button
        type="button"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40"
      >
        Anterior
      </button>
      <span className="text-sm tabular-nums">
        Página {page + 1} de {totalPages} · {totalElements} resultados
      </span>
      <button
        type="button"
        disabled={page >= totalPages - 1}
        onClick={() => onPage(page + 1)}
        className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40"
      >
        Siguiente
      </button>
    </nav>
  )
}
