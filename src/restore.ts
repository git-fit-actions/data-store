import * as core from "@actions/core";
import { restoreCache } from "@actions/cache";
import { buildCacheKeys, parseSources, sourcePaths } from "./shared";

async function run(): Promise<void> {
  const sources = parseSources(
    core.getInput("sources") || undefined,
    core.getInput("source") || undefined
  );

  for (const src of sources) {
    const { sentinel, prefix } = buildCacheKeys(src);
    core.info(`[${src}] Restoring from cache...`);
    const matchedKey = await restoreCache(sourcePaths(src), sentinel, [prefix]);
    if (matchedKey) {
      core.info(`[${src}] Restored (key: ${matchedKey})`);
    } else {
      core.info(`[${src}] No cache found, skipped`);
    }
  }
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
