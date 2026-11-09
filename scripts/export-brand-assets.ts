import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  doorwayArtwork,
  wordmarkArtwork,
  hubertArtwork,
  svgDocument,
} from '../elsewhere/web/src/brandArtwork';
const destination = new URL('../elsewhere/web/public/brand/', import.meta.url);
await mkdir(destination, { recursive: true });
const motionMedia = new URL('../assets/brand/motion/media/', import.meta.url);
await mkdir(motionMedia, { recursive: true });
const wordmark = wordmarkArtwork;
const lightDoorway = doorwayArtwork.replaceAll('#99583f', '#dca48c');
for (const [name, svg] of Object.entries({
  'elsewhere-mark.svg': svgDocument('0 0 104 104', doorwayArtwork, 'color="#243b36"'),
  'elsewhere-wordmark.svg': svgDocument('0 0 630 112', wordmark, 'color="#243b36"'),
  'elsewhere-lockup.svg': svgDocument(
    '0 0 820 140',
    `<g transform="translate(6 14)">${doorwayArtwork}</g><g transform="translate(136 3)">${wordmark}</g>`,
    'color="#243b36"',
  ),
  'elsewhere-lockup-light.svg': svgDocument(
    '0 0 820 140',
    `<g transform="translate(6 14)">${lightDoorway}</g><g transform="translate(136 3)">${wordmark}</g>`,
    'color="#f4f0e4"',
  ),
  'hubert.svg': svgDocument('0 0 320 320', hubertArtwork),
})) {
  await writeFile(new URL(name, destination), svg + '\n');
  await writeFile(new URL(name, motionMedia), svg + '\n');
}
await writeFile(
  new URL('../elsewhere/web/public/favicon.svg', import.meta.url),
  svgDocument(
    '0 0 104 104',
    `<rect width="104" height="104" rx="22" fill="#f4f0e4"/><g transform="translate(10 7) scale(.83)">${doorwayArtwork}</g>`,
    'color="#243b36"',
  ) + '\n',
);

await writeFile(
  new URL('design-tokens.css', destination),
  await readFile(new URL('../elsewhere/web/src/ui/tokens.css', import.meta.url)),
);
