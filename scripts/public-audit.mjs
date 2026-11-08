import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { extname, resolve } from 'node:path';

// Audit tracked files as well as new candidates: force-adding an ignored private file must fail.
const root = process.cwd();
let files;
try {
  files = [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean),
    ),
  ];
} catch {
  console.error('Public source audit requires a local Git repository.');
  process.exit(1);
}
const findings = [];
const text = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.html',
  '.md',
  '.yml',
  '.yaml',
  '.toml',
  '.css',
  '.txt',
  '.sh',
]);
const patterns = [
  /\b(?:sk|rk)_(?:live|test)_[a-zA-Z0-9]{28,}\b/,
  /\bgh[pousr]_[a-zA-Z0-9]{30,}\b/,
  /\bgithub_pat_[a-zA-Z0-9_]{40,}\b/,
  /\bsk-(?:ant-|or-)?[a-zA-Z0-9_-]{35,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
for (const path of files) {
  if (
    /(^|\/)(?:\.data|\.agents|\.codex|\.npmrc|\.idea|\.vscode|node_modules|reports|research_notes|test-results|playwright-report)(\/|$)/.test(
      path,
    ) ||
    (/(^|\/)\.env(?:\.|$)/.test(path) && path !== '.env.example') ||
    /(?:\.sqlite(?:-[^/]+)?|\.db|\.pem|\.key|\.env|\.local\.md|\.log)$/.test(path) ||
    /(^|\/)(?:auth-secret|owner-token)$/.test(path)
  ) {
    findings.push(`${path}: private/local file`);
    continue;
  }
  const file = resolve(root, path);
  const info = lstatSync(file);
  if (!info.isFile()) {
    findings.push(`${path}: non-regular file`);
    continue;
  }
  if (info.size > 95 * 1024 * 1024) {
    findings.push(`${path}: large file needs explicit publication handling`);
    continue;
  }
  if (
    (text.has(extname(path)) || path === '.env.example' || path === 'Dockerfile') &&
    info.size < 4 * 1024 * 1024 &&
    patterns.some((pattern) => pattern.test(readFileSync(file, 'utf8')))
  )
    findings.push(`${path}: possible credential material (value withheld)`);
}
if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Public source audit passed for ${files.length} candidate files. No upload or commit was made. Targeted checks do not replace secret scanning or review.`,
  );
