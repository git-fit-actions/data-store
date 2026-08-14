import * as core from "@actions/core";
import { restoreCache } from "@actions/cache";
import {
  buildCacheKeys,
  glyphFor,
  LEGEND,
  needsLegend,
  parseSources,
  shortCacheKey,
  sourcePaths,
  writeSummary,
} from "./shared";

async function run(): Promise<void> {
  const sources = parseSources(
    core.getInput("sources") || undefined,
    core.getInput("source") || undefined
  );

  const statuses: string[] = [];
  const keys: string[] = [];
  for (const src of sources) {
    const { sentinel, prefix } = buildCacheKeys(src);
    core.info(`[${src}] Restoring from cache...`);
    const matchedKey = await restoreCache(sourcePaths(src), sentinel, [prefix]);
    if (matchedKey) {
      core.info(`[${src}] Restored (key: ${matchedKey})`);
      statuses.push("hit");
      keys.push(shortCacheKey(src, matchedKey));
    } else {
      core.info(`[${src}] No cache found, skipped`);
      statuses.push("miss");
      keys.push("—");
    }
  }

  writeSummary(
    "data-store restore",
    ["Source", ...sources],
    [
      ["Status", ...statuses.map(glyphFor)],
      ["Cache key", ...keys],
    ],
    needsLegend(statuses) ? LEGEND : undefined,
    ["left", ...sources.map(() => "center" as const)]
  );
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
