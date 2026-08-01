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

```
GitFit-data-<source>-v0-cold              (restore key)
GitFit-data-<source>-v0-*                 (restore-keys prefix)
GitFit-data-<source>-v0-<run>-<id>[-<attempt>]  (save key)
```

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
