export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    people:
      'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM1 22v-3a7 7 0 0 1 14 0v3m1-18a4 4 0 0 1 0 8m1 3a6 6 0 0 1 6 6',
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16',
    mail: 'M3 4h18v14H8l-5 3Zm4 5h10m-10 4h6',
    activity: 'M2 12h5l3-8 4 16 3-8h5',
    star: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
    game: 'M7 6h10a5 5 0 0 1 5 5v6a3 3 0 0 1-5 2l-2-2H9l-2 2a3 3 0 0 1-5-2v-6a5 5 0 0 1 5-5Zm-2 6h6m-3-3v6m8-5h.01m3 3h.01',
    gear: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    walk: 'M14 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM7 11l4-3 4 2 4 1m-8-3-1 7-4 7m4-7 5 2 1 5',
    expand: 'M8 3H3v5m13-5h5v5m0 8v5h-5M8 21H3v-5',
    close: 'm6 6 12 12M6 18 18 6',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm4 5-3 5-5 3 3-5Z',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.compass} />
    </svg>
  );
}
