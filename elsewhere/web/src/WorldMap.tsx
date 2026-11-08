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
  const world = snapshot?.world;
  if (!world) return null;
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
          if (!visitor) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onMove({
            x: b.minX + ((event.clientX - rect.left) / rect.width) * width,
            z: b.minZ + ((event.clientY - rect.top) / rect.height) * height,
          });
        }}
      >
        <rect x={b.minX} y={b.minZ} width={width} height={height} fill="#dce4cc" />
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
                    ? '#94bdb1'
                    : p.id === 'workshop' || p.id === 'library'
                      ? '#c9c7ad'
                      : '#bdcda6'
                }
                stroke="#a5b791"
                strokeWidth=".3"
              />
              <text
                x={(p.bounds.minX + p.bounds.maxX) / 2}
                y={(p.bounds.minZ + p.bounds.maxZ) / 2}
                fontSize="2.5"
                fill="#596d49"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {p.name.replace(/^The /, '')}
              </text>
            </g>
          ))}
        {world.entities?.map((entity) => (
          <g key={entity.id} aria-label={entity.name} style={{ pointerEvents: 'none' }}>
            <title>
              {entity.species ?? entity.name} · {entity.behavior}
            </title>
            <circle
              cx={entity.position.x}
              cy={entity.position.z}
              r={entity.kind === 'butterfly' ? 0.6 : 0.75}
              fill={entity.kind === 'butterfly' ? '#c5a15b' : '#aa815a'}
              stroke="#f6efda"
              strokeWidth=".25"
            />
          </g>
        ))}
        {world.residents.map((r) => (
          <circle
            key={r.id}
            cx={r.position.x}
            cy={r.position.z}
            r="1.2"
            fill="#3b6648"
            stroke="#f9f3dd"
            strokeWidth=".5"
          />
        ))}
        {visitor && (
          <circle
            cx={visitor.position.x}
            cy={visitor.position.z}
            r="1.25"
            fill="#6f91a8"
            stroke="#fff9e8"
            strokeWidth=".5"
          />
        )}
      </svg>
      <div className="map-key">
        <span>
          <i />
          Hubert
        </span>
        <span>
          <i />
          You
        </span>
        <span>
          <i style={{ background: '#aa815a' }} />
          Wildlife
        </span>
      </div>
    </div>
  );
}
