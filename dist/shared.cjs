"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/shared.ts
var shared_exports = {};
__export(shared_exports, {
  LEGEND: () => LEGEND,
  SOURCE_RE: () => SOURCE_RE,
  ValidationError: () => ValidationError,
  buildCacheKeys: () => buildCacheKeys,
  buildSummaryMarkdown: () => buildSummaryMarkdown,
  compareChecksums: () => compareChecksums,
  computeChecksumMap: () => computeChecksumMap,
  generateSHA256SUMS: () => generateSHA256SUMS,
  glyphFor: () => glyphFor,
  hashFile: () => hashFile,
  isDirectory: () => isDirectory,
  isFile: () => isFile,
  listDataFiles: () => listDataFiles,
  needsLegend: () => needsLegend,
  parseChecksumFile: () => parseChecksumFile,
  parseSources: () => parseSources,
  shortCacheKey: () => shortCacheKey,
  sourcePaths: () => sourcePaths,
  writeSummary: () => writeSummary
});
module.exports = __toCommonJS(shared_exports);
var crypto = __toESM(require("crypto"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var SOURCE_RE = /^[a-z0-9][a-z0-9_-]*$/;
var RESERVED_SOURCE_NAMES = /* @__PURE__ */ new Set([
  "source",
  "sources",
  "changed",
  "changed_sources",
  "unchanged_sources"
]);
var ValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
};
function parseSources(sourcesInput, legacySourceInput) {
  if (sourcesInput && legacySourceInput) {
    throw new ValidationError(
      "Provide either 'sources' or 'source', not both"
    );
  }
  let raw;
  if (sourcesInput) {
    raw = sourcesInput.split(/[,\n]/);
  } else if (legacySourceInput) {
    raw = [legacySourceInput];
  } else {
    throw new ValidationError("Provide a 'sources' or 'source' input");
  }
  const seen = /* @__PURE__ */ new Set();
  const errors = [];
  const result = [];
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
function buildCacheKeys(source) {
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
function sourcePaths(source) {
  return [`data/raw/${source}`, `data/std/${source}`];
}
function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function compareBytewise(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
function listDataFiles(dir) {
  const results = [];
  const walk = (prefix) => {
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
function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
function computeChecksumMap(dir) {
  const map = /* @__PURE__ */ new Map();
  for (const rel of listDataFiles(dir)) {
    map.set(rel, hashFile(path.join(dir, rel)));
  }
  return map;
}
function parseChecksumFile(filePath) {
  const map = /* @__PURE__ */ new Map();
  let malformed = false;
  let content;
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
function mapsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}
function compareChecksums(dir) {
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
function generateSHA256SUMS(dir) {
  const lines = listDataFiles(dir).map(
    (rel) => `${hashFile(path.join(dir, rel))}  ./${rel}`
  );
  const content = lines.length > 0 ? `${lines.join("\n")}
` : "";
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), content);
}
function buildSummaryMarkdown(heading, headers, rows, footer, alignments) {
  const escape = (s) => s.replace(/\|/g, "\\|");
  const separator = headers.map((_, i) => {
    const a = alignments?.[i];
    if (a === "center") return ":---:";
    if (a === "right") return "---:";
    return "---";
  }).join(" | ");
  const lines = [
    `### GitFit ${heading}`,
    "",
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${separator} |`
  ];
  for (const row of rows) {
    lines.push(`| ${row.map(escape).join(" | ")} |`);
  }
  if (footer) {
    lines.push("", footer);
  }
  return lines.join("\n");
}
function writeSummary(heading, headers, rows, footer, alignments, filePath) {
  const target = filePath || process.env.GITHUB_STEP_SUMMARY;
  if (!target) {
    throw new Error(
      "GITHUB_STEP_SUMMARY is not set \u2014 step summaries require a GitHub Actions runtime"
    );
  }
  fs.writeFileSync(
    target,
    buildSummaryMarkdown(heading, headers, rows, footer, alignments)
  );
}
var LEGEND = "_\u2705 \u6B63\u5E38\u4EA7\u51FA \xB7 \u23ED\uFE0F \u9884\u6599\u5185\u65E0\u53D8\u5316/\u515C\u5E95 \xB7 \u274C \u5931\u8D25_";
var GLYPH_OK = /* @__PURE__ */ new Set([
  "hit",
  "ok",
  "saved",
  "imported",
  "attempted",
  "changed",
  "pushed",
  "present",
  "cache"
]);
var GLYPH_SKIP = /* @__PURE__ */ new Set([
  "miss",
  "skipped",
  "unchanged",
  "none",
  "git"
]);
var GLYPH_FAIL = /* @__PURE__ */ new Set(["failed", "errors", "missing"]);
var LEGEND_TRIGGER = /* @__PURE__ */ new Set(["miss", "failed", "errors", "missing"]);
function needsLegend(statuses) {
  return statuses.some((s) => LEGEND_TRIGGER.has(s.split(/\s/)[0]));
}
function glyphFor(status) {
  if (GLYPH_OK.has(status) || GLYPH_OK.has(status.split(/\s/)[0])) {
    return `\u2705 ${status}`;
  }
  if (GLYPH_SKIP.has(status) || GLYPH_SKIP.has(status.split(/\s/)[0])) {
    return `\u23ED\uFE0F ${status}`;
  }
  if (GLYPH_FAIL.has(status) || GLYPH_FAIL.has(status.split(/\s/)[0])) {
    return `\u274C ${status}`;
  }
  return status;
}
function shortCacheKey(source, key) {
  if (!key) {
    return "\u2014";
  }
  const prefix = `GitFit-data-${source}-v0-`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LEGEND,
  SOURCE_RE,
  ValidationError,
  buildCacheKeys,
  buildSummaryMarkdown,
  compareChecksums,
  computeChecksumMap,
  generateSHA256SUMS,
  glyphFor,
  hashFile,
  isDirectory,
  isFile,
  listDataFiles,
  needsLegend,
  parseChecksumFile,
  parseSources,
  shortCacheKey,
  sourcePaths,
  writeSummary
});
