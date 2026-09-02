export default function BookLoading() {
  return (
    <div className="shell">
      <main className="main" id="main">
        <div className="container stack stack--lg" aria-busy="true" aria-live="polite">
          <span className="visually-hidden">Loading available times…</span>
          <div className="skeleton" style={{ height: "2.75rem", width: "22rem" }} />
          <div className="booking-layout">
            <div className="skeleton" style={{ height: "22rem" }} />
            <div className="skeleton" style={{ height: "22rem" }} />
          </div>
        </div>
      </main>
    </div>
  );
}
