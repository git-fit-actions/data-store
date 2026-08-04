# git-fit-actions/data-store

GitHub Actions for caching and restoring git-fit data sources (L1 raw / L2 std).

## Actions

| Path | Description |
|------|-------------|
| `cache/restore` | Restore a data source from cache before syncing |
| `cache/save` | Detect changes, refresh SHA256SUMS, save to cache after syncing |

## Usage

```yaml
steps:
  - uses: git-fit-actions/data-store/cache/restore@v1
    with:
      source: keep
  - name: Run sync
    run: bundle exec git fit sync --checkpoint
  - uses: git-fit-actions/data-store/cache/save@v1
    with:
      source: keep
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `source` | yes | Data source name used in cache keys, paths and step titles (e.g. `keep`). Must match `^[a-z0-9][a-z0-9_-]*$`. |

## Outputs

| Action | Output | Description |
|--------|--------|-------------|
| `cache/save` | `changed` | Whether any managed directory changed. |

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
- Per-run sync caches are saved as `-v0-<run>-<id>`.

Managed paths: `data/raw/<source>` and `data/std/<source>`.

## Permissions

| Action | Required |
|--------|----------|
| `cache/restore` | `actions: read` |
| `cache/save` | `actions: write` |

## Security

`source` is validated against `^[a-z0-9][a-z0-9_-]*$` before any filesystem or cache operation. Invalid values fail fast.

## License

MIT
