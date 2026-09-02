export function Rail() {
  return (
    <nav className="rail">
      <div className="logo" title="switch workspace" />
      <div className="rbtn on" title="Agents">
        <svg viewBox="0 0 24 24">
          <rect x="8" y="4" width="8" height="7" />
          <path d="M5 20v-2c0-2.2 3.1-4 7-4s7 1.8 7 4v2" />
        </svg>
      </div>
      <div className="rbtn" title="Files — coming soon">
        <svg viewBox="0 0 24 24">
          <path d="M4 6h6l2 2h8v11H4Z" />
        </svg>
      </div>
      <div className="sp" />
      <div className="uav" title="you">
        Y
      </div>
    </nav>
  );
}
