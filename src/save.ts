import * as core from "@actions/core";
import { saveCache } from "@actions/cache";
import {
  buildCacheKeys,
  compareChecksums,
  generateSHA256SUMS,
  isDirectory,
  parseSources,
  sourcePaths,
} from "./shared";

async function run(): Promise<void> {
  const sources = parseSources(
    core.getInput("sources") || undefined,
    core.getInput("source") || undefined
  );

  let anyChanged = false;
  const changedSources: string[] = [];
  const unchangedSources: string[] = [];
  const failedSources: string[] = [];

  for (const src of sources) {
    const dirs = sourcePaths(src).filter(isDirectory);

    if (dirs.length === 0) {
      core.info(`[${src}] No managed directories exist, skipping`);
      core.setOutput(`changed_${src}`, "false");
      unchangedSources.push(src);
      continue;
    }

    let srcChanged = false;
    for (const dir of dirs) {
      const changed = compareChecksums(dir);
      core.info(`${changed ? "changed" : "unchanged"}: ${dir}`);
      if (changed) {
        srcChanged = true;
      }
      generateSHA256SUMS(dir);
    }

    core.setOutput(`changed_${src}`, srcChanged ? "true" : "false");

    if (srcChanged) {
      anyChanged = true;
      changedSources.push(src);
      const { runKey } = buildCacheKeys(src);
      core.info(`[${src}] Changed, saving to cache...`);
      const saved = await saveCache(dirs, runKey);
      if (saved) {
        core.info(`[${src}] Saved (key: ${runKey})`);
      } else {
        failedSources.push(src);
        core.warning(
          `[${src}] Save failed: another job may be creating this cache (key: ${runKey}); data is unchanged locally`
        );
      }
    } else {
      unchangedSources.push(src);
      core.info(`[${src}] Unchanged, skipped`);
    }
  }

  core.setOutput("changed", anyChanged ? "true" : "false");
  core.setOutput("changed_sources", changedSources.join(","));
  core.setOutput("unchanged_sources", unchangedSources.join(","));
  core.setOutput("save_errors", failedSources.join(","));
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
