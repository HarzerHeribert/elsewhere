export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    people:
      'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM1 22v-3a7 7 0 0 1 14 0v3m1-18a4 4 0 0 1 0 8m1 3a6 6 0 0 1 6 6',
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16',
    mail: 'M3 4h18v14H8l-5 3Zm4 5h10m-10 4h6',
    thought:
      'M8 5a4 4 0 0 1 7-1 4 4 0 0 1 4 6 3.5 3.5 0 0 1-3 5H8a4 4 0 0 1-1-8Zm-1 13h.01M4.5 21h.01',
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
    sidebar: 'M4 4h16v16H4ZM9 4v16',
    'chevron-right': 'm9 6 6 6-6 6',
    'chevron-left': 'm15 6-6 6 6 6',
    'chevron-down': 'm6 9 6 6 6-6',
    more: 'M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
    pencil: 'm4 20 1-4L16 5l3 3L8 19Zm10-13 3 3',
    pin: 'M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    book: 'M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4Zm16 0h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6Z',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
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
