"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  parseSources,
  ValidationError,
  buildCacheKeys,
  sourcePaths,
  compareChecksums,
  generateSHA256SUMS,
  listDataFiles,
} = require("../dist/shared.cjs");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "data-store-test-"));
}

function writeTree(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(base, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

// ── parseSources ──

test("parseSources: comma-separated list", () => {
  assert.deepEqual(parseSources("keep,igpsport,xoss", undefined), [
    "keep",
    "igpsport",
    "xoss",
  ]);
});

test("parseSources: newline-separated list", () => {
  assert.deepEqual(parseSources("keep\nigpsport\nxoss", undefined), [
    "keep",
    "igpsport",
    "xoss",
  ]);
});

test("parseSources: mixed separators with spaces", () => {
  assert.deepEqual(parseSources("keep, igpsport\nxoss", undefined), [
    "keep",
    "igpsport",
    "xoss",
  ]);
});

test("parseSources: filters empty items", () => {
  assert.deepEqual(parseSources("keep,,igpsport,\n", undefined), [
    "keep",
    "igpsport",
  ]);
});

test("parseSources: dedups preserving first-occurrence order", () => {
  assert.deepEqual(parseSources("keep,igpsport,keep", undefined), [
    "keep",
    "igpsport",
  ]);
});

test("parseSources: legacy single source input", () => {
  assert.deepEqual(parseSources(undefined, "keep"), ["keep"]);
});

test("parseSources: legacy source goes through same validation", () => {
  assert.throws(() => parseSources(undefined, "bad source"), ValidationError);
});

test("parseSources: both inputs rejected", () => {
  assert.throws(
    () => parseSources("keep", "igpsport"),
    /not both/
  );
});

test("parseSources: no inputs rejected", () => {
  assert.throws(() => parseSources(undefined, undefined), /Provide/);
});

test("parseSources: invalid name rejected with all errors reported", () => {
  assert.throws(
    () => parseSources("keep,Bad_Name.,xoss", undefined),
    /Invalid source 'Bad_Name\.'/
  );
});

test("parseSources: reserved names rejected", () => {
  for (const reserved of [
    "sources",
    "source",
    "changed",
    "changed_sources",
    "unchanged_sources",
  ]) {
    assert.throws(
      () => parseSources(`keep,${reserved}`, undefined),
      /reserved name/
    );
  }
});

test("parseSources: whitespace-only input rejected", () => {
  assert.throws(() => parseSources("  \n,", undefined), /No valid sources/);
});

// ── buildCacheKeys ──

test("buildCacheKeys: key templates byte-identical to composite", () => {
  const saved = { ...process.env };
  try {
    process.env.GITHUB_RUN_NUMBER = "42";
    process.env.GITHUB_RUN_ID = "999";
    process.env.GITHUB_RUN_ATTEMPT = "1";
    const keys = buildCacheKeys("keep");
    assert.equal(keys.sentinel, "GitFit-data-keep-v0-sentinel");
    assert.equal(keys.prefix, "GitFit-data-keep-v0-");
    assert.equal(keys.runKey, "GitFit-data-keep-v0-42-999");
  } finally {
    Object.assign(process.env, saved);
  }
});

test("buildCacheKeys: run attempt suffix only when > 1", () => {
  const saved = { ...process.env };
  try {
    process.env.GITHUB_RUN_NUMBER = "1";
    process.env.GITHUB_RUN_ID = "2";
    process.env.GITHUB_RUN_ATTEMPT = "2";
    assert.equal(buildCacheKeys("keep").runKey, "GitFit-data-keep-v0-1-2-2");
    process.env.GITHUB_RUN_ATTEMPT = "1";
    assert.equal(buildCacheKeys("keep").runKey, "GitFit-data-keep-v0-1-2");
    delete process.env.GITHUB_RUN_ATTEMPT;
    assert.equal(buildCacheKeys("keep").runKey, "GitFit-data-keep-v0-1-2");
  } finally {
    Object.assign(process.env, saved);
  }
});

test("buildCacheKeys: falls back when run env missing (local dev)", () => {
  const saved = { ...process.env };
  try {
    delete process.env.GITHUB_RUN_NUMBER;
    delete process.env.GITHUB_RUN_ID;
    delete process.env.GITHUB_RUN_ATTEMPT;
    const keys = buildCacheKeys("keep");
    assert.equal(keys.runKey, "GitFit-data-keep-v0-0-0");
  } finally {
    Object.assign(process.env, saved);
  }
});

test("sourcePaths: raw and std under data/", () => {
  assert.deepEqual(sourcePaths("keep"), ["data/raw/keep", "data/std/keep"]);
});

// ── checksum logic ──

test("compareChecksums: no baseline counts as changed", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "a.txt": "hello\n" });
  assert.equal(compareChecksums(dir), true);
});

test("compareChecksums: unchanged dir", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "a.txt": "hello\n", "sub/b.txt": "world\n" });
  generateSHA256SUMS(dir);
  assert.equal(compareChecksums(dir), false);
});

test("compareChecksums: modified file", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "a.txt": "hello\n" });
  generateSHA256SUMS(dir);
  fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
  assert.equal(compareChecksums(dir), true);
});

test("compareChecksums: added file", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "a.txt": "hello\n" });
  generateSHA256SUMS(dir);
  writeTree(dir, { "b.txt": "new\n" });
  assert.equal(compareChecksums(dir), true);
});

test("compareChecksums: deleted file", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "a.txt": "hello\n", "b.txt": "bye\n" });
  generateSHA256SUMS(dir);
  fs.unlinkSync(path.join(dir, "b.txt"));
  assert.equal(compareChecksums(dir), true);
});

test("compareChecksums: order-insensitive baseline (improvement over bash)", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "a.txt": "hello\n", "b.txt": "bye\n" });
  const shuffled = listDataFiles(dir)
    .slice()
    .reverse()
    .map((rel) => `${require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(dir, rel))).digest("hex")}  ./${rel}`);
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), `${shuffled.join("\n")}\n`);
  assert.equal(compareChecksums(dir), false);
});

test("compareChecksums: malformed baseline counts as changed", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "a.txt": "hello\n" });
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), "not-a-checksum-line\n");
  assert.equal(compareChecksums(dir), true);
});

test("compareChecksums: empty dir with empty baseline unchanged", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  generateSHA256SUMS(dir);
  assert.equal(fs.statSync(path.join(dir, "SHA256SUMS")).size, 0);
  assert.equal(compareChecksums(dir), false);
});

test("compareChecksums: nested SHA256SUMS files excluded like find -name", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, {
    "a.txt": "x\n",
    "sub/b.txt": "y\n",
    "sub/SHA256SUMS": "bogus\n",
  });
  assert.deepEqual(listDataFiles(dir), ["a.txt", "sub/b.txt"]);
});

test("generateSHA256SUMS: files with spaces survive round-trip", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "sub/b .txt": "world\n" });
  generateSHA256SUMS(dir);
  assert.equal(compareChecksums(dir), false);
});

test("generateSHA256SUMS: byte-identical to bash pipeline, passes sha256sum --check", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "a.txt": "hello\n", "sub/b .txt": "world\n" });
  generateSHA256SUMS(dir);
  const generated = fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8");
  const bashOutput = execFileSync(
    "bash",
    [
      "-c",
      'cd "$1" && find . -type f ! -name "SHA256SUMS" -print0 | sort -z | xargs -0 sha256sum',
      "bash",
      dir,
    ]
  ).toString();
  assert.equal(generated, bashOutput);
  execFileSync("bash", [
    "-c",
    'cd "$1" && sha256sum --check --quiet SHA256SUMS',
    "bash",
    dir,
  ]);
});

test("generateSHA256SUMS: idempotent", () => {
  const dir = path.join(tmpdir(), "keep");
  fs.mkdirSync(dir, { recursive: true });
  writeTree(dir, { "a.txt": "hello\n" });
  generateSHA256SUMS(dir);
  const first = fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8");
  generateSHA256SUMS(dir);
  assert.equal(
    fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8"),
    first
  );
});
