import { villageScenery } from './scenery';
import type { Position, Snapshot } from './types';
import type { VisitorSessionView } from '@elsewhere/character-interfaces';

export function WorldMap({
  snapshot,
  visitor,
  onFocus,
  onMove,
}: {
  snapshot: Snapshot | null;
  visitor: VisitorSessionView | null;
  onFocus: (position: Position, id: string) => void;
  onMove: (position: Position) => void;
}) {
  const world = snapshot?.world ?? villageScenery;
  const b = world.bounds,
    width = b.maxX - b.minX,
    height = b.maxZ - b.minZ;
  return (
    <div className="world-map" aria-label="Map of Elsewhere">
      <div className="map-title">
        <span>ELSEWHERE</span>
        <span>N ↑</span>
      </div>
      <svg
        viewBox={`${b.minX} ${b.minZ} ${width} ${height}`}
        role="img"
        aria-label="Places, Hubert and your position in Elsewhere"
        onClick={(event) => {
          if (!visitor || !snapshot) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onMove({
            x: b.minX + ((event.clientX - rect.left) / rect.width) * width,
            z: b.minZ + ((event.clientY - rect.top) / rect.height) * height,
          });
        }}
      >
        <rect x={b.minX} y={b.minZ} width={width} height={height} fill="var(--ew-paper)" />
        {world.places
          .filter((p) => p.id !== 'meadow')
          .map((p) => (
            <g
              key={p.id}
              onClick={(event) => {
                event.stopPropagation();
                onFocus(
                  {
                    x: (p.bounds.minX + p.bounds.maxX) / 2,
                    z: (p.bounds.minZ + p.bounds.maxZ) / 2,
                  },
                  p.id,
                );
              }}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={p.bounds.minX + 0.5}
                y={p.bounds.minZ + 0.5}
                width={p.bounds.maxX - p.bounds.minX - 1}
                height={p.bounds.maxZ - p.bounds.minZ - 1}
                rx="1.5"
                fill={
                  p.id === 'pond'
                    ? 'var(--ew-surface-muted)'
                    : p.id === 'workshop' || p.id === 'library'
                      ? 'var(--ew-line)'
                      : 'var(--ew-surface)'
                }
                stroke="var(--ew-line-strong)"
                strokeWidth=".3"
              />
              <text
                x={(p.bounds.minX + p.bounds.maxX) / 2}
                y={(p.bounds.minZ + p.bounds.maxZ) / 2}
                fontSize="2.5"
                fill="var(--ew-text)"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {p.name.replace(/^The /, '')}
              </text>
            </g>
          ))}
        {snapshot?.world.entities?.map((entity) => (
          <g key={entity.id} aria-label={entity.name} style={{ pointerEvents: 'none' }}>
            <title>
              {entity.species ?? entity.name} · {entity.behavior}
            </title>
            <circle
              cx={entity.position.x}
              cy={entity.position.z}
              r={entity.kind === 'butterfly' ? 0.6 : 0.75}
              fill="var(--ew-text-muted)"
              stroke="var(--ew-surface)"
              strokeWidth=".25"
            />
          </g>
        ))}
        {snapshot?.world.residents.map((r) => (
          <circle
            key={r.id}
            cx={r.position.x}
            cy={r.position.z}
            r="1.2"
            fill="var(--ew-accent)"
            stroke="var(--ew-surface)"
            strokeWidth=".5"
          />
        ))}
        {visitor && snapshot && (
          <circle
            cx={visitor.position.x}
            cy={visitor.position.z}
            r="1.25"
            fill="var(--ew-surface)"
            stroke="var(--ew-ink)"
            strokeWidth=".5"
          />
        )}
      </svg>
      <div className="map-key">
        <span>
          <i className="map-resident" />
          Hubert
        </span>
        <span>
          <i className="map-visitor" />
          You
        </span>
        <span>
          <i className="map-wildlife" />
          Wildlife
        </span>
      </div>
    </div>
  );
}
