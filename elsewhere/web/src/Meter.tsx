export function Meter({ label, value }: { label: string; value: number }) {
  const n = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        <span>
          {n}
          <small> / 100</small>
        </span>
      </div>
      <div
        className={'stat-track ' + label.toLowerCase()}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={n}
      >
        <i style={{ width: n + '%' }} />
      </div>
    </div>
  );
}
