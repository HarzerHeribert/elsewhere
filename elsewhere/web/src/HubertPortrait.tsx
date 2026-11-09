import appearance from '../../../characters/hubert/appearance.json';

/** Hubert's winged-seed feelers, cream mask and paddle feet also identify him on the map panels. */
export function HubertPortrait() {
  const c = appearance.palette;
  return (
    <div
      className="avatar hubert-portrait"
      role="img"
      aria-label="Hubert, an unclassified Elsewhere creature"
    >
      <svg viewBox="0 0 104 104" aria-hidden="true">
        <ellipse cx="52" cy="95" rx="36" ry="5.2" fill={c.deepMoss} opacity=".13" />
        <ellipse cx="53" cy="88" rx="12" ry="9" fill={c.deepMoss} />
        <ellipse cx="31" cy="93" rx="14" ry="6" transform="rotate(-12 31 93)" fill={c.moss} />
        <ellipse cx="75" cy="93" rx="13" ry="6" transform="rotate(13 75 93)" fill={c.moss} />
        <path d="M40 29C28 33 6 24 3 8 20 4 33 11 40 29Z" fill={c.moss} />
        <path d="M3 8c7-1 15-1 22 5l-3 3 7 6C17 15 11 12 3 8Z" fill={c.leafTip} />
        <path d="M58 29c8-16 26-19 40-14-7 12-24 18-40 14Z" fill={c.moss} />
        <path d="M98 15c-4 6-11 10-21 12l3-4-9 1c10-3 19-6 27-9Z" fill={c.leafTip} />
        <path
          d="M47 19c18-1 33 11 39 32 7 24 0 39-29 42-26 3-43-6-44-24-1-12 4-23 9-32 6-10 13-17 25-18Z"
          fill={c.body}
        />
        <path d="M47 20c8-1 16 2 23 8-11-4-19-2-23 1l5-7-13 5Z" fill={c.ochre} />
        <path
          d="M19 60c0-16 10-27 24-25l9 2c10-5 19-2 24 4 11 14 8 31-2 40-11 10-32 12-44 5-8-5-12-13-11-26Z"
          fill={c.belly}
        />
        <ellipse cx="27" cy="58" rx="7" ry="4" fill={c.blush} />
        <ellipse cx="75" cy="57" rx="6" ry="4" fill={c.blush} />
        <ellipse cx="36" cy="48" rx="8" ry="9.7" transform="rotate(-9 36 48)" fill={c.eyes} />
        <ellipse cx="65" cy="46.5" rx="8.5" ry="10" transform="rotate(8 65 46.5)" fill={c.eyes} />
        <circle cx="34" cy="45" r="2.3" fill={c.highlight} />
        <circle cx="63" cy="43" r="2.3" fill={c.highlight} />
        <path
          d="M46 62q4 4 8-1"
          fill="none"
          stroke={c.markings}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <g fill={c.ochre}>
          <ellipse cx="42" cy="72" rx="2.6" ry="1.3" transform="rotate(12 42 72)" />
          <ellipse cx="59" cy="72" rx="2.6" ry="1.3" transform="rotate(-12 59 72)" />
          <ellipse cx="51" cy="76" rx="2.3" ry="1.6" />
        </g>
        <g fill={c.markings}>
          <circle cx="23" cy="57" r="1" />
          <circle cx="27" cy="60" r=".9" />
          <circle cx="74" cy="58" r=".9" />
          <circle cx="78" cy="56" r="1" />
        </g>
      </svg>
    </div>
  );
}
