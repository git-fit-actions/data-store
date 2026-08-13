# git-fit-actions/data-store

GitHub Actions for caching and restoring git-fit data sources (L1 raw / L2 std).

## Actions

| Path | Type | Description |
|------|------|-------------|
| `cache/restore` | node24 | Restore data sources from cache before syncing (single call, multi-source) |
| `cache/save` | node24 | Detect changes, refresh SHA256SUMS, save to cache after syncing (single call, multi-source) |
| `.` (repo root, `@v2`) | node24, main + post | Write-once: restore in main, save changed sources in post at job end |

## Usage

### cache/restore

```yaml
steps:
  - uses: git-fit-actions/data-store/cache/restore@v2
    with:
      sources: keep,igpsport,xoss,xingzhe,garmin,garmin_cn,strava
```

### cache/save

```yaml
steps:
  - id: save
    uses: git-fit-actions/data-store/cache/save@v2
    with:
      sources: |
        keep
        igpsport
        xoss
        xingzhe
        garmin
        garmin_cn
        strava
```

### Write-once (data-store@v2)

Restores all sources in `main`; runs the save logic automatically in `post` at the
end of the job, **only when the whole job succeeded** (`post-if: success()`).
Suitable for consumers that do not need the save outputs downstream.

```yaml
permissions:
  actions: write   # required: save runs in post

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: git-fit-actions/data-store@v2
        with:
          sources: keep,igpsport,xoss,xingzhe,garmin,garmin_cn,strava
      - run: bundle exec git fit sync --checkpoint
```

Semantics to know:

- The post step cannot make its results available to earlier steps: **no outputs**.
- A failed job never saves (failed steps make the post condition `success()` false).
- Change detection happens at post time, so it covers every change made anywhere
  in the job (same as any explicit `cache/save` placed at the end of a job).

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `source` | no (legacy) | Single data source name. Must match `^[a-z0-9][a-z0-9_-]*$`. |
| `sources` | no | Comma- or newline-separated list of data source names. Each must match `^[a-z0-9][a-z0-9_-]*$`. |

Exactly one of `source` / `sources` must be provided (providing both fails).
The list is trimmed, deduplicated (first occurrence order kept) and validated
**fully up front**: any invalid entry fails the action before any cache or
filesystem operation.

Reserved source names (rejected): `source`, `sources`, `changed`,
`changed_sources`, `unchanged_sources`.

## Outputs

| Action | Output | Description |
|--------|--------|-------------|
| `cache/save` | `changed` | `true` if any source changed. |
| `cache/save` | `changed_sources` | Comma-joined list of changed sources (empty if none). |
| `cache/save` | `unchanged_sources` | Comma-joined list of unchanged sources (empty if none). |
| `cache/save` | `save_errors` | Comma-joined list of sources whose cache upload failed (another job reserved the key). Empty if all changed sources saved. Local data is untouched. |
| `cache/save` | `changed_<source>` | Per-source change status, e.g. `changed_keep`. Dynamic output: not declared in the metadata, documented here only. |

The write-once action exposes no outputs (post outputs are not readable by
earlier steps).

## Step summaries

Both actions append a markdown block to the job step summary:

- `cache/restore` → `### GitFit data-store restore`, one row per source
  (`| Source | Status | Cache key |`); status is `hit` (with the matched key) or
  `miss`.
- `cache/save` → `### GitFit data-store save`, one row per source plus a
  `Changed: N / Unchanged: M / Errors: K` footer; status is `saved`, `unchanged`,
  `skipped` (no managed directories) or `failed`.

The write-once root action produces both blocks: restore in `main`, save in
`post` (post cannot surface outputs, so the summary is the only channel).

## Cache key scheme

All keys share a `GitFit-data-<source>-v0-` prefix. `cache/restore` never writes a cache:
its exact `key` is a sentinel that always misses, forcing a `restore-keys` prefix match that
selects the most recently created cache.

```
GitFit-data-<source>-v0-sentinel          (restore exact key — sentinel, never written)
GitFit-data-<source>-v0-*                 (restore-keys prefix — most recent wins)
GitFit-data-<source>-v0-<run>-<id>[-<attempt>]  (sync save key)
GitFit-data-<source>-v0-snapshot          (unarchive recovery snapshot — external convention)
```

- **sentinel** (`-v0-sentinel`): restore-only exact key, never written; guarantees prefix fallback.
- **snapshot** (`-v0-snapshot`): written by unarchive workflows (git → cache) as a readable recovery snapshot.
- Per-run sync caches are saved as `-v0-<run>-<id>[-<attempt>]`.

Managed paths: `data/raw/<source>` and `data/std/<source>`. Only existing
directories are cached; a source with neither directory is skipped.

## Checksums

- `cache/save` compares each managed directory against its `SHA256SUMS` baseline.
  The comparison is set-based (order independent); a missing or malformed
  baseline counts as changed.
- `SHA256SUMS` is regenerated on every save for every existing directory
  (idempotent), byte-identical to
  `find . -type f ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 sha256sum`.
- Only changed sources are written to the cache.

## Permissions

| Action | Required |
|--------|----------|
| `cache/restore` | `actions: read` |
| `cache/save` | `actions: write` |
| `.` (write-once) | `actions: write` (save runs in post) |

## Security

`source` / `sources` are validated against `^[a-z0-9][a-z0-9_-]*$` (plus the
reserved-name list) before any filesystem or cache operation. The regex
excludes `/`, `.` and newlines, so path traversal and output injection are
impossible; invalid values fail fast.

## Development

```sh
npm ci
npm run build     # esbuild bundles into cache/restore/dist, cache/save/dist, dist/shared.cjs
npm test          # unit tests (node:test) — includes byte-parity vs the bash pipeline
npm run typecheck # tsc --noEmit
```

`dist/` is committed (GitHub Actions requirement for JS actions). After any
dependency or source change, run `npm run build` and commit the result; the
`check-dist` workflow enforces this.

## Versioning

- `@v1` remains the original composite actions (single `source` input only).
- `@v2` introduces the `sources` input and the node24 runtime; the `source`
  input stays available for backward compatibility.
- Release by tagging `v2`; the root write-once action becomes usable as
  `git-fit-actions/data-store@v2` with the same tag.

## License

MIT
