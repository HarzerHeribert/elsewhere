import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const token =
  process.env.ADMIN_TOKEN ??
  readFileSync(resolve(process.env.DATA_DIR ?? '.data', 'owner-token'), 'utf8').trim();
const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
console.log(
  `Private local owner link (do not share):\n${origin}/#owner=${encodeURIComponent(token)}`,
);
