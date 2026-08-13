import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export const SOURCE_RE = /^[a-z0-9][a-z0-9_-]*$/;

const RESERVED_SOURCE_NAMES = new Set([
  "source",
  "sources",
  "changed",
  "changed_sources",
  "unchanged_sources",
]);

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Parse the `sources` (comma/newline separated) or legacy single `source`
 * input into a deduplicated, validated list. All validation happens up front:
 * any invalid entry fails the whole action before any cache or filesystem
 * operation, matching the fail-fast discipline of the original composite.
 */
export function parseSources(
  sourcesInput: string | undefined,
  legacySourceInput: string | undefined
): string[] {
  if (sourcesInput && legacySourceInput) {
    throw new ValidationError(
      "Provide either 'sources' or 'source', not both"
    );
  }

  let raw: string[];
  if (sourcesInput) {
    raw = sourcesInput.split(/[,\n]/);
  } else if (legacySourceInput) {
    raw = [legacySourceInput];
  } else {
    throw new ValidationError("Provide a 'sources' or 'source' input");
  }

  const seen = new Set<string>();
  const errors: string[] = [];
  const result: string[] = [];

  for (const item of raw) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    if (!SOURCE_RE.test(trimmed)) {
      errors.push(`Invalid source '${trimmed}' (must match ${SOURCE_RE})`);
      continue;
    }
    if (RESERVED_SOURCE_NAMES.has(trimmed)) {
      errors.push(`Invalid source '${trimmed}' (reserved name)`);
      continue;
    }
    result.push(trimmed);
  }

  if (errors.length > 0) {
    throw new ValidationError(errors.join("; "));
  }
  if (result.length === 0) {
    throw new ValidationError("No valid sources provided");
  }
  return result;
}

export interface CacheKeys {
  sentinel: string;
  prefix: string;
  runKey: string;
}

/**
 * Per-source cache keys, byte-identical to the composite implementation and
 * to the key conventions shared with the archive/unarchive workflows:
 *
 *   GitFit-data-<source>-v0-sentinel          (restore exact key, never written)
 *   GitFit-data-<source>-v0-*                 (restore-keys prefix, most recent wins)
 *   GitFit-data-<source>-v0-<run>-<id>[-<attempt>]  (save key)
 */
export function buildCacheKeys(source: string): CacheKeys {
  const sentinel = `GitFit-data-${source}-v0-sentinel`;
  const prefix = `GitFit-data-${source}-v0-`;
  const runNumber = process.env.GITHUB_RUN_NUMBER || "0";
  const runId = process.env.GITHUB_RUN_ID || "0";
  const runAttempt = Number.parseInt(
    process.env.GITHUB_RUN_ATTEMPT || "1",
    10
  );
  const attemptSuffix = runAttempt > 1 ? `-${runAttempt}` : "";
  const runKey = `GitFit-data-${source}-v0-${runNumber}-${runId}${attemptSuffix}`;
  return { sentinel, prefix, runKey };
}

export function sourcePaths(source: string): string[] {
  return [`data/raw/${source}`, `data/std/${source}`];
}

export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function compareBytewise(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Recursively list data files (excluding any file named SHA256SUMS, matching
 * `find . -type f ! -name 'SHA256SUMS'`), sorted byte-wise to match
 * `sort -z` under LC_ALL=C. Symlinks are not followed, matching find defaults.
 */
export function listDataFiles(dir: string): string[] {
  const results: string[] = [];
  const walk = (prefix: string): void => {
    const full = prefix ? path.join(dir, prefix) : dir;
    const dirents = fs.readdirSync(full, { withFileTypes: true });
    dirents.sort((a, b) => compareBytewise(a.name, b.name));
    for (const d of dirents) {
      const rel = prefix ? `${prefix}/${d.name}` : d.name;
      if (d.isDirectory()) {
        walk(rel);
      } else if (d.isFile() && d.name !== "SHA256SUMS") {
        results.push(rel);
      }
    }
  };
  walk("");
  results.sort(compareBytewise);
  return results;
}

export function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function computeChecksumMap(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rel of listDataFiles(dir)) {
    map.set(rel, hashFile(path.join(dir, rel)));
  }
  return map;
}

/**
 * Parse a SHA256SUMS file (text or binary mode lines) into a map of
 * relative path -> hash. Unparseable lines are reported via `malformed`,
 * which callers treat as "changed" so a corrupted baseline is regenerated.
 */
export function parseChecksumFile(filePath: string): {
  map: Map<string, string>;
  malformed: boolean;
} {
  const map = new Map<string, string>();
  let malformed = false;
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { map, malformed: true };
  }
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) {
      malformed = true;
      continue;
    }
    map.set(m[2].replace(/^\.\//, ""), m[1]);
  }
  return { map, malformed };
}

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

/**
 * Whether the directory's content differs from its SHA256SUMS baseline.
 * Equivalent to `sha256sum --check` + full-list comparison, but order
 * independent (immune to sort/locale drift that the bash string equality
 * was sensitive to). No baseline or a malformed baseline counts as changed.
 */
export function compareChecksums(dir: string): boolean {
  const baselinePath = path.join(dir, "SHA256SUMS");
  if (!isFile(baselinePath)) {
    return true;
  }
  const { map: baseline, malformed } = parseChecksumFile(baselinePath);
  if (malformed) {
    return true;
  }
  return !mapsEqual(baseline, computeChecksumMap(dir));
}

/**
 * Regenerate SHA256SUMS, byte-identical to
 * `find . -type f ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 sha256sum`
 * (`HASH  ./path` lines, trailing newline, empty file for an empty dir).
 */
export function generateSHA256SUMS(dir: string): void {
  const lines = listDataFiles(dir).map(
    (rel) => `${hashFile(path.join(dir, rel))}  ./${rel}`
  );
  const content = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), content);
}

/**
 * Build a markdown step-summary block for a git-fit action. Pure function
 * (no @actions/core I/O) so it is unit-testable:
 *
 *   ### GitFit <heading>
 *
 *   | header1 | header2 |
 *   |---------|---------|
 *   | a       | b       |
 *
 *   <footer>
 *
 * Pipe characters in cell values are escaped so untrusted inputs cannot
 * break the table layout.
 */
export function buildSummaryMarkdown(
  heading: string,
  headers: string[],
  rows: string[][],
  footer?: string
): string {
  const escape = (s: string): string => s.replace(/\|/g, "\\|");
  const separator = headers.map(() => "---").join(" | ");
  const lines: string[] = [
    `### GitFit ${heading}`,
    "",
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${separator} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${row.map(escape).join(" | ")} |`);
  }
  if (footer) {
    lines.push("", footer);
  }
  return lines.join("\n");
}

/**
 * Write a step-summary block to `$GITHUB_STEP_SUMMARY` (or an explicit path,
 * for tests). Overwrites the file with just this block — the caller's step
 * owns its summary file, so a single write is all that is needed. Missing
 * target fails fast with an actionable message.
 */
export function writeSummary(
  heading: string,
  headers: string[],
  rows: string[][],
  footer?: string,
  filePath?: string
): void {
  const target = filePath || process.env.GITHUB_STEP_SUMMARY;
  if (!target) {
    throw new Error(
      "GITHUB_STEP_SUMMARY is not set — step summaries require a GitHub Actions runtime"
    );
  }
  fs.writeFileSync(target, buildSummaryMarkdown(heading, headers, rows, footer));
}
