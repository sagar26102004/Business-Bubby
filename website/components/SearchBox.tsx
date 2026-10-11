/** A plain GET form to /search — works with JavaScript off, and on every phone. */
export function SearchBox({ defaultValue, autoFocus }: { defaultValue?: string; autoFocus?: boolean }) {
  return (
    <form action="/search" method="get" className="searchbox" role="search">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search cafés, salons, plumbers, rentals…"
        aria-label="Search businesses"
        autoFocus={autoFocus}
        enterKeyHint="search"
      />
      <button type="submit" className="btn btn-primary btn-sm">
        Search
      </button>
    </form>
  );
}
