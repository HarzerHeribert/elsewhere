/** A place where a character can publish files of its own: a public site it writes to directly. */
export interface CharacterStudio {
  /** The public root of the site. */
  site(): { url: string };
  /** The current text of a file, or null when it does not exist yet. */
  read(path: string): Promise<{ text: string; sha: string } | null>;
  /** Creates or replaces one file. Nothing is reviewed before it is published. */
  write(input: {
    path: string;
    text: string;
    message: string;
    expectedSha?: string;
  }): Promise<{ commitSha: string; fileUrl: string; pageUrl: string }>;
}

/** Lowercase relative paths of publishable text files, at most 120 characters. */
export const STUDIO_PATH =
  /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.(html|md|css|js|json|svg|txt|csv)$/;
export const STUDIO_PATH_LIMIT = 120;
export const STUDIO_TEXT_LIMIT = 16000;

/** Where a file of a site rooted at `root` (ending in a slash) is shown to visitors. */
export function studioPageUrl(root: string, path: string): string {
  if (path === 'index.html') return root;
  if (path.endsWith('/index.html')) return root + path.slice(0, -'index.html'.length);
  if (path.endsWith('.md')) return root + path.slice(0, -'.md'.length) + '.html';
  return root + path;
}
