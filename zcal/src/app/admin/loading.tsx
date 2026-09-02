/** Shown while a server component fetches from SQLite. */
export default function AdminLoading() {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading…</span>
      <div className="skeleton" style={{ height: "2.5rem", width: "16rem" }} />
      <div className="grid">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="skeleton" style={{ height: "5.5rem" }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: "16rem" }} />
    </div>
  );
}
