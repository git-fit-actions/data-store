import * as core from "@actions/core";
import { restoreCache } from "@actions/cache";
import {
  buildCacheKeys,
  parseSources,
  sourcePaths,
  writeSummary,
} from "./shared";

async function run(): Promise<void> {
  const sources = parseSources(
    core.getInput("sources") || undefined,
    core.getInput("source") || undefined
  );

  const rows: string[][] = [];
  for (const src of sources) {
    const { sentinel, prefix } = buildCacheKeys(src);
    core.info(`[${src}] Restoring from cache...`);
    const matchedKey = await restoreCache(sourcePaths(src), sentinel, [prefix]);
    if (matchedKey) {
      core.info(`[${src}] Restored (key: ${matchedKey})`);
      rows.push([src, "hit", matchedKey]);
    } else {
      core.info(`[${src}] No cache found, skipped`);
      rows.push([src, "miss", "—"]);
    }
  }

  writeSummary("data-store restore", ["Source", "Status", "Cache key"], rows);
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
