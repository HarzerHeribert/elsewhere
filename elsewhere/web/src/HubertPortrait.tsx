import appearance from '../../../characters/hubert/appearance.json';

/** The same creature silhouette and palette as Hubert's world model. */
export function HubertPortrait() {
  const c = appearance.palette;
  return (
    <div
      className="avatar hubert-portrait"
      role="img"
      aria-label="Hubert, an unclassified Elsewhere creature"
    >
      <svg viewBox="0 0 96 110" aria-hidden="true">
        <ellipse cx="49" cy="101" rx="32" ry="5" fill={c.deepMoss} opacity=".1" />
        <ellipse cx="48" cy="94" rx="12" ry="7" fill={c.deepMoss} />
        <ellipse cx="26" cy="98" rx="13" ry="6" transform="rotate(-13 26 98)" fill={c.moss} />
        <ellipse cx="70" cy="98" rx="12" ry="6" transform="rotate(16 70 98)" fill={c.moss} />
        <path d="M32 36C20 33 13 19 17 8c13 6 22 16 23 27Z" fill={c.moss} />
        <path d="M59 33c5-17 19-22 27-13-10 1-9 13-23 19Z" fill={c.moss} />
        <path
          d="M31 38C35 21 53 18 66 28c11 8 14 21 16 35 4 17-5 32-32 34-24 1-37-9-35-26 1-16 4-25 16-33Z"
          fill={c.body}
        />
        <path
          d="M29 69c2-11 10-17 20-15 17 0 25 11 24 23-1 10-9 16-24 16-14 0-23-9-20-24Z"
          fill={c.belly}
        />
        <ellipse cx="36" cy="54" rx="7.5" ry="10" transform="rotate(-5 36 54)" fill={c.eyes} />
        <ellipse cx="62" cy="52" rx="7" ry="9" transform="rotate(8 62 52)" fill={c.eyes} />
        <circle cx="33.5" cy="50.5" r="2.1" fill={c.highlight} />
        <circle cx="59.5" cy="49" r="2" fill={c.highlight} />
        <circle cx="38.5" cy="57.5" r=".8" fill={c.highlight} opacity=".65" />
        <circle cx="64.5" cy="55.5" r=".8" fill={c.highlight} opacity=".65" />
        <path
          d="M46 68q4 3 7-1"
          fill="none"
          stroke={c.deepMoss}
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <circle cx="25" cy="65" r="2" fill={c.ochre} />
        <circle cx="27" cy="71" r="1.3" fill={c.ochre} />
        <circle cx="73" cy="63" r="1.5" fill={c.ochre} />
        <path d="m45 82 4-4 4 5-4 5Z" fill={c.ochre} opacity=".85" />
        <circle cx="18" cy="10" r="3" fill={c.ochre} />
      </svg>
    </div>
  );
}
