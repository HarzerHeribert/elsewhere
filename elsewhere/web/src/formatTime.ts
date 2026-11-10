/** A real moment as a time of day in the reader's own timezone. */
export function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
/** The calendar day a real moment falls on in the reader's timezone, as a running number. */
export function calendarDay(at: number) {
  return Math.floor((at - new Date(at).getTimezoneOffset() * 60_000) / 86_400_000);
}
export function formatDay(day: number, length: 'long' | 'short' = 'long') {
  return new Date(day * 86_400_000).toLocaleDateString([], {
    ...(length === 'long' ? { weekday: 'short' as const } : {}),
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
