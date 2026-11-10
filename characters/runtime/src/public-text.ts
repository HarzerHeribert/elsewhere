const normalise = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * True when `text` reproduces a run of at least `minimumRun` consecutive characters of any private
 * text (case and whitespace insensitive). Private texts shorter than the run must appear whole, and
 * only count when they have at least 12 characters.
 */
export function reproducesPrivateText(
  text: string,
  privateTexts: readonly string[],
  minimumRun = 40,
): boolean {
  const haystack = normalise(text);
  if (!haystack) return false;
  for (const raw of privateTexts) {
    const source = normalise(raw);
    if (!source) continue;
    if (source.length < minimumRun) {
      if (source.length >= 12 && haystack.includes(source)) return true;
      continue;
    }
    for (let start = 0; start + minimumRun <= source.length; start++)
      if (haystack.includes(source.slice(start, start + minimumRun))) return true;
  }
  return false;
}
