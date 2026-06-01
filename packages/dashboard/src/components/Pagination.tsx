interface Props {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}

export function Pagination({ total, limit, offset, onChange }: Props) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (totalPages <= 1) return null;

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <div className="pagination">
      <button
        className="btn btn-secondary btn-sm"
        disabled={!hasPrev}
        onClick={() => onChange(0)}
      >
        «
      </button>
      <button
        className="btn btn-secondary btn-sm"
        disabled={!hasPrev}
        onClick={() => onChange(offset - limit)}
      >
        ‹ Prev
      </button>
      <span className="pagination-info">
        Page {currentPage} of {totalPages} ({total} total)
      </span>
      <button
        className="btn btn-secondary btn-sm"
        disabled={!hasNext}
        onClick={() => onChange(offset + limit)}
      >
        Next ›
      </button>
      <button
        className="btn btn-secondary btn-sm"
        disabled={!hasNext}
        onClick={() => onChange((totalPages - 1) * limit)}
      >
        »
      </button>
    </div>
  );
}
