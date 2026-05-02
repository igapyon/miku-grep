# miku-grep CLI Specification v20260502

## Purpose

`miku-grep` is a local-first repository search CLI for generative AI agents and automation.

The tool is a grep replacement focused on finding files and snippets that an agent should read next. It returns structured JSON, diagnostics, and summaries instead of human-oriented plain text.

`miku-grep` is not a semantic retrieve tool. It does not perform embedding search, ranking by meaning, or Git repository root discovery.

## Scope

MVP scope:

- Node CLI
- `--version`
- stdin JSON request
- stdout JSON result
- `content` / `filename` / `both`
- `literal` / `regex`
- glob-based include / exclude
- recursive search with `maxDepth`
- `utf-8` / `shift_jis`
- encoding rules
- diagnostics
- `detail` / `file-summary`

Out of scope for MVP:

- semantic retrieve
- MCP
- Java CLI
- Git root auto detection
- encoding auto detection

## CLI Contract

The CLI uses stdin / stdout as its primary interface.

```text
stdin
  request JSON

stdout
  result JSON
  success and expected failures should return JSON whenever possible

stderr
  progress, verbose logs, unexpected runtime-level messages
```

stdout must not contain progress or verbose logs. Agents and scripts should be able to parse stdout as JSON.

Request validation errors, dangerous requests, decode errors, skips, truncation, and expected search failures are represented in stdout result JSON.

stdout result JSON should be pretty-printed with 2-space indentation and a trailing newline.

```text
JSON.stringify(result, null, 2) + "\n"
```

`--version` and `--help` are exceptions to the stdin request JSON contract.

```bash
miku-grep --version
miku-grep --help
```

`--version` prints a short version string to stdout and exits with code `0`.

`--help` prints a self-contained command description to stdout and exits with code `0`.
The help output should be detailed enough for an AI agent to understand the
stdin / stdout contract, request fields, defaults, limits, result shape,
diagnostics, and examples without reading the full specification.

These commands exist so release assets and Agent Skills can inspect or smoke-test
a runtime artifact without preparing a request JSON.

The bundled `.mjs` runtime artifact should embed the package version at build time, such as `BUNDLED_PACKAGE_VERSION`, and `--version` should use that embedded value when package metadata is unavailable.

## Exit Codes

```text
0
  ok: true

1
  ok: false
  request JSON was parsed, but validation, dangerous request, or expected search failure occurred

2
  malformed stdin / CLI usage error
  stdin is not parseable JSON, or CLI invocation itself is invalid

3
  unexpected runtime error
  result JSON could not be built reliably
```

For exit code `1`, stdout should contain `ok: false` result JSON whenever possible.

For exit code `2` or `3`, the CLI should return stdout JSON whenever it can be built reliably. However, malformed stdin, invalid CLI invocation, or unexpected runtime failure may prevent constructing a valid result JSON. In those cases, stderr-only error reporting is allowed, and callers must use the exit code as authoritative.

## Schema Version

Request JSON and result JSON must both have top-level `version: 1`.

`version` is the stdin / stdout schema version. It is used by Agent Skills, future Java CLI implementations, test fixtures, and compatibility checks.

Unknown fields in request JSON are validation errors.

This keeps agent-generated typos from being silently ignored.

## Request JSON

Example:

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "RepositoryMap"
  },
  "search": {
    "target": "content",
    "recursive": true,
    "maxDepth": 8,
    "includeFileNamePatterns": ["*.java", "*.md"],
    "excludeFileNamePatterns": ["*.generated.md"],
    "excludeDirNamePatterns": ["tmp"]
  },
  "output": {
    "mode": "detail",
    "maxMatches": 200,
    "maxMatchesPerFile": 20,
    "maxLineLength": 240
  },
  "encoding": {
    "default": "utf-8",
    "rules": [
      {
        "fileNamePattern": "*.java",
        "encoding": "shift_jis"
      }
    ],
    "onDecodeError": "skip"
  }
}
```

### root

`root` is the search entry point.

If `root` is a relative path, it is resolved from the CLI process current working directory.

`miku-grep` does not auto-detect the Git repository root. It searches only under `request.root`.

Result `file` values are relative paths from `request.root`. Absolute paths must not be returned in result JSON.

Result paths must use `/` as the path separator on every platform, including Windows.

Examples:

```text
request.root = "docs"
file = "miku-soft-00-overview-design-v20260427.md"

request.root = "."
file = "docs/miku-soft-00-overview-design-v20260427.md"
```

### query

```json
{
  "type": "literal",
  "text": "RepositoryMap"
}
```

`query.type` values:

```text
literal
  literal string search

regex
  regular expression search
```

`query.type: "literal"` uses simple substring matching.

```text
String.includes equivalent
case-sensitive
no Unicode normalization
no locale-aware comparison
no case folding
```

`query.type: "regex"` affects only search query interpretation. It does not change include / exclude pattern handling.

MVP search is case-sensitive.

MVP does not provide `caseSensitive` or `ignoreCase` options.

When case variation is needed, express it in `query.type: "regex"` pattern text.

MVP Node CLI uses Node.js `RegExp` for `query.type: "regex"`.

Content regex search is applied line by line. Multi-line regex matching is outside MVP.

MVP does not accept JavaScript-specific regex flags.

A future Java CLI may use Java's regex engine. Cross-runtime regex behavior is not guaranteed to be identical for all edge cases. Prefer portable basic regex patterns when the same request should work across Node and Java runtimes.

### search

`search.target` values:

```text
content
  search file contents

filename
  search request.root-relative file paths

both
  search both file paths and file contents
```

`filename` mode searches the request.root-relative file path, not only the basename.

### recursive / maxDepth

`recursive` is explicit.

When `recursive` is omitted, it defaults to `true`.

When `recursive: true`, omitted `maxDepth` defaults to `20`.

`maxDepth` must not exceed `50`.

```json
{
  "recursive": true,
  "maxDepth": 8
}
```

Search defaults:

```json
{
  "recursive": true,
  "maxDepth": 20,
  "maxFileBytes": 10485760
}
```

### include / exclude

`includeFileNamePatterns`, `excludeFileNamePatterns`, and `excludeDirNamePatterns` are glob patterns.

These are separate from `query.type: "regex"`.

MVP glob syntax supports only `*` and `?`.

```text
*
  matches zero or more characters within one basename

?
  matches exactly one character within one basename
```

Glob matching does not cross path separators.

`includeFileNamePatterns` and `excludeFileNamePatterns` match the basename only. They do not match request.root-relative paths.

`excludeDirNamePatterns` matches directory basenames only.

Path-level include / exclude, such as `includePathPatterns` or `excludePathPatterns`, is outside MVP.

MVP always applies the default exclude preset. There is no option to disable it.

Request `excludeFileNamePatterns` and `excludeDirNamePatterns` are additional excludes.

Missing or empty `includeFileNamePatterns` means no include restriction.

Missing or empty `excludeFileNamePatterns` means no request-level file exclude beyond the default exclude preset.

Missing or empty `excludeDirNamePatterns` means no request-level directory exclude beyond the default exclude preset.

Default exclude dir names:

```text
.git
.svn
node_modules
target
build
dist
.gradle
.idea
.vscode
.settings
vendor
```

Default exclude file name patterns:

```text
*.class
*.jar
*.zip
*.png
*.jpg
*.jpeg
*.gif
*.pdf
.classpath
.project
```

Include / exclude priority:

```text
1. If includeFileNamePatterns is specified, only matching files remain candidates.
2. Default exclude preset is applied.
3. Request excludeFileNamePatterns and excludeDirNamePatterns are applied.
```

### dotfiles

Dotfiles are included in search targets by default.

Only dot directories and files covered by the default exclude preset, such as `.git`, `.svn`, `.gradle`, `.idea`, `.vscode`, `.settings`, `.classpath`, and `.project`, are excluded by default.

### symlinks

MVP does not follow symlinks.

Skipped symlinks may be reported as `info` diagnostics when useful, but they are not treated as search failures.

## Encoding Policy

MVP does not perform auto detection or best-effort decode.

Policy:

```text
Do not guess.
Do not fail silently.
Return the applied encoding rule.
Return unreadable files in diagnostics.
```

Supported encodings:

```text
utf-8
shift_jis
```

Encoding rule priority:

```text
1. pathPattern
2. fileNamePattern
3. encoding.default
4. tool default utf-8
```

Encoding defaults:

```text
encoding.default
  utf-8

encoding.rules
  []

encoding.onDecodeError
  skip
```

For UTF-8 input, a leading UTF-8 BOM is removed from the decoded content before searching.

Example:

```json
{
  "default": "utf-8",
  "rules": [
    {
      "fileNamePattern": "*.java",
      "encoding": "shift_jis"
    },
    {
      "pathPattern": "legacy/**/*.txt",
      "encoding": "shift_jis"
    },
    {
      "pathPattern": "docs/**/*.md",
      "encoding": "utf-8"
    }
  ],
  "onDecodeError": "skip"
}
```

## Binary Files

MVP treats files as binary when either of the following is true.

- The file matches the default binary-like exclude file name patterns, such as `*.class`, `*.jar`, `*.zip`, `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, or `*.pdf`
- The file content contains a NUL byte during content search

Binary files are not searched in `content` mode.

When a binary file is skipped during content search, the skip should be represented in `diagnostics[]` rather than silently hidden.

## File Size Limit

MVP has a content-read size limit.

```json
{
  "search": {
    "maxFileBytes": 10485760
  }
}
```

`search.maxFileBytes` defaults to 10 MiB.

`search.maxFileBytes` must not exceed 100 MiB (`104857600`).

Files larger than `search.maxFileBytes` are skipped for content search and reported in `diagnostics[]`.

## Result JSON

### Output Defaults

When `output` is omitted or partially specified, MVP applies these defaults.

```json
{
  "mode": "file-summary",
  "maxMatches": 200,
  "maxMatchesPerFile": 20,
  "maxLineLength": 240,
  "maxSnippetsPerFile": 3
}
```

Field meanings:

```text
mode
  Default is file-summary because agents usually need to narrow candidate files first.

maxMatches
  Maximum total hit count.
  Must not exceed 10000.

maxMatchesPerFile
  Maximum hit count per file.
  Must not exceed 1000.

maxLineLength
  Maximum returned snippet text length.
  Must not exceed 4000.

maxSnippetsPerFile
  Maximum number of representative snippets in file-summary mode.
  Must not exceed 100.
```

Allowed `output.mode` values:

```text
detail
file-summary
```

Any other `output.mode` is a validation error.

Successful result example:

```json
{
  "version": 1,
  "ok": true,
  "error": null,
  "effectiveRequest": {
    "root": ".",
    "query": {
      "type": "literal",
      "text": "RepositoryMap"
    },
    "search": {
      "target": "content",
      "recursive": true,
      "maxDepth": 8,
      "maxFileBytes": 10485760,
      "includeFileNamePatterns": ["*.java", "*.md"],
      "excludeFileNamePatterns": ["*.class", "*.jar", "*.zip", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.pdf", ".classpath", ".project", "*.generated.md"],
      "excludeDirNamePatterns": [".git", ".svn", "node_modules", "target", "build", "dist", ".gradle", ".idea", ".vscode", ".settings", "vendor", "tmp"]
    },
    "output": {
      "mode": "detail",
      "maxMatches": 200,
      "maxMatchesPerFile": 20,
      "maxLineLength": 240
    },
    "encoding": {
      "default": "utf-8",
      "rules": [
        {
          "fileNamePattern": "*.java",
          "encoding": "shift_jis"
        }
      ],
      "onDecodeError": "skip"
    }
  },
  "matches": [
    {
      "type": "content",
      "file": "src/main/java/example/App.java",
      "line": 42,
      "text": "class RepositoryMap {",
      "trimmed": false,
      "encoding": "shift_jis",
      "encodingRule": {
        "type": "fileNamePattern",
        "pattern": "*.java"
      }
    }
  ],
  "summary": {
    "filesVisited": 140,
    "filesScanned": 120,
    "filesMatched": 3,
    "matches": 8,
    "diagnostics": 0,
    "truncated": false,
    "truncatedReason": null
  },
  "diagnostics": []
}
```

Expected failure example:

```json
{
  "version": 1,
  "ok": false,
  "error": {
    "code": "root_not_accessible",
    "message": "root is not accessible"
  },
  "effectiveRequest": {
    "root": "./private-repo",
    "query": {
      "type": "literal",
      "text": "RepositoryMap"
    },
    "search": {
      "target": "content",
      "recursive": true,
      "maxDepth": 8,
      "maxFileBytes": 10485760
    },
    "output": {
      "mode": "detail",
      "maxMatches": 200,
      "maxMatchesPerFile": 20,
      "maxLineLength": 240
    },
    "encoding": {
      "default": "utf-8",
      "rules": [],
      "onDecodeError": "skip"
    }
  },
  "matches": [],
  "summary": {
    "filesVisited": 0,
    "filesScanned": 0,
    "filesMatched": 0,
    "matches": 0,
    "diagnostics": 1,
    "truncated": false,
    "truncatedReason": null
  },
  "diagnostics": [
    {
      "severity": "error",
      "code": "root_not_accessible",
      "message": "root is not accessible",
      "path": "./private-repo"
    }
  ]
}
```

## effectiveRequest

Result JSON should return `effectiveRequest` whenever possible.

`effectiveRequest` is the actual search condition after defaults and normalization are applied.

It makes result JSON self-contained and helps agents decide the next search.

## Matches

`output.mode` may change the schema of `matches[]` items. Every item must have `type`.

Line numbers are 1-based.

Line splitting normalizes both LF and CRLF as line separators.

When `maxLineLength` is applied to a content hit, the returned `text` should be a snippet around the match when the match position is available. If a match-centered snippet cannot be produced reliably, the line may be trimmed from the beginning.

When text is shortened, `trimmed` must be `true`.

`text` must contain only text derived from the source file. Do not add artificial ellipses such as `...` to the returned `text`.

When a snippet starts after the beginning of the original line, return `textStartColumn`.

`textStartColumn` is 1-based.

When `maxMatchesPerFile` is reached, search for that file stops, but traversal continues to the next file. This should be visible through `summary.truncated` / `summary.truncatedReason` and diagnostics when useful.

### detail

`detail` returns one item per hit.

Content hit:

```json
{
  "type": "content",
  "file": "src/main/java/example/App.java",
  "line": 42,
  "column": 7,
  "matchedText": "RepositoryMap",
  "text": "class RepositoryMap {",
  "trimmed": false,
  "encoding": "shift_jis",
  "encodingRule": {
    "type": "fileNamePattern",
    "pattern": "*.java"
  }
}
```

`column` is 1-based. `matchedText` is the matched substring.

When `text` is shortened, include `textStartColumn` if the snippet does not start at column 1.

Filename hit:

```json
{
  "type": "filename",
  "file": "src/main/java/example/RepositoryMap.java",
  "matchedText": "src/main/java/example/RepositoryMap.java"
}
```

### file-summary

`file-summary` returns one item per matched file.

```json
{
  "type": "file",
  "file": "src/main/java/example/RepositoryMap.java",
  "matchTypes": ["filename", "content"],
  "filenameMatched": true,
  "contentMatched": true,
  "lines": [42, 84, 120],
  "matchCount": 3,
  "snippets": [
    {
      "type": "content",
      "line": 42,
      "text": "class RepositoryMap {",
      "trimmed": false
    }
  ],
  "encoding": "shift_jis",
  "encodingRule": {
    "type": "fileNamePattern",
    "pattern": "*.java"
  }
}
```

Filename match and content match are identified by `type`. Do not add `matchType`.

```text
detail mode
  type: "filename"
  type: "content"

file-summary mode
  type: "file"
  matchTypes: ["filename", "content"]
  filenameMatched: true | false
  contentMatched: true | false
```

## Diagnostics

`diagnostics[]` is structured information for trust, skipped files, warnings, and errors.

If `request.root` is not accessible, the result is `ok: false`.

If some files or directories under an accessible root cannot be read, the search continues with `ok: true` and warning diagnostics.

Required fields:

```text
severity
  error | warning | info

code
  machine-readable snake_case diagnostic code

message
  short human-readable message
```

Optional fields:

```text
file
  request.root-relative file path

path
  path that is not necessarily a file

line
  line location when available

skipped
  true when the target was skipped

encoding
  encoding related to this diagnostic

encodingRule
  applied encoding rule

details
  object for machine-readable extra information
```

Decode error example:

```json
{
  "severity": "warning",
  "code": "decode_error",
  "message": "file could not be decoded and was skipped",
  "file": "src/main/java/App.java",
  "skipped": true,
  "encoding": "shift_jis",
  "encodingRule": {
    "type": "fileNamePattern",
    "pattern": "*.java"
  }
}
```

Limit example:

```json
{
  "severity": "info",
  "code": "max_matches",
  "message": "search stopped because maxMatches was reached",
  "details": {
    "maxMatches": 200
  }
}
```

### Diagnostic Codes

Validation and expected-failure diagnostic codes are listed in
`Validation Error Codes`.

MVP runtime diagnostic codes include:

```text
directory_not_readable
  directory could not be read and was skipped

symlink_skipped
  symlink was skipped because MVP does not follow symlinks

file_not_readable
  file could not be read and was skipped

max_file_bytes_exceeded
  file exceeded search.maxFileBytes and was skipped

binary_file_skipped
  file was treated as binary and skipped during content search

decode_error
  file could not be decoded with the applied encoding rule and was skipped

max_matches
  search stopped because output.maxMatches was reached

max_matches_per_file
  search for a file stopped because output.maxMatchesPerFile was reached

max_snippets_per_file
  file-summary snippets were omitted because output.maxSnippetsPerFile was reached
```

## Summary

`summary` lets agents and scripts judge result size, scanned range, and truncation.

```json
{
  "filesVisited": 140,
  "filesScanned": 98,
  "filesMatched": 3,
  "matches": 8,
  "diagnostics": 2,
  "truncated": false,
  "truncatedReason": null
}
```

Field meanings:

```text
filesVisited
  Number of files discovered by traversal before include / exclude and binary skip.

filesScanned
  Number of files actually processed for search.
  For content search, this means files decoded and searched.
  For filename search, this means files checked by file path matching.

filesMatched
  Number of files with at least one hit.

matches
  Total hit count.
  In detail mode this usually equals matches[] length.
  In file-summary mode this may differ from matches[] length.

diagnostics
  diagnostics[] item count.

truncated
  true when result is omitted or search is stopped by limits.

truncatedReason
  Main truncation reason when truncated is true.
  Candidate values: max_matches / max_matches_per_file / max_line_length / max_snippets_per_file
```

## Dangerous Requests

The CLI should reject dangerous or invalid requests as expected failures.

Examples:

- `root` does not exist
- `root` is too broad
- `root` is `/` or a home directory
- `query.text` is empty
- regex is invalid
- `maxMatches` is too large
- `maxMatchesPerFile` is too large
- `maxDepth` is too large
- `maxLineLength` is too large
- `maxSnippetsPerFile` is too large
- `maxFileBytes` is too large
- default exclude preset is not enough to make a very large directory safe
- binary file is requested for content search

## Validation Error Codes

MVP should use stable validation error codes.

Minimum codes:

```text
invalid_request
unknown_field
invalid_version
invalid_query_type
invalid_search_target
invalid_output_mode
invalid_regex
root_not_found
root_not_accessible
root_too_broad
empty_query
max_matches_too_large
max_matches_per_file_too_large
max_depth_too_large
max_line_length_too_large
max_snippets_per_file_too_large
max_file_bytes_too_large
invalid_encoding
invalid_encoding_rule
```

## Sort

MVP output should be stable.

File traversal and matched files are sorted by request.root-relative file path ascending where practical.

Content hits are sorted by line ascending within each file.

When `search.target: "both"` produces both filename and content hits for the same file in `detail` mode, filename hits should appear before content hits for that file.

Diagnostics should be emitted in stable order where practical. Prefer path / file ascending, then line ascending when present, then code ascending.

`effectiveRequest` should be serialized with stable key order matching the documented request shape.

MVP match sort order:

```text
file path asc
line asc
```

Future sort modes such as score sort or modified-time sort are outside MVP.

## Node.js Runtime Artifact

MVP should provide a single-file Node.js CLI runtime artifact for downstream Agent Skills and release assets.

Recommended build outputs:

```text
bundle/miku-grep.mjs
bundle/miku-grep-sources.tgz
```

`bundle/miku-grep.mjs` is the executable runtime artifact.

`bundle/miku-grep-sources.tgz` is for rebuild, audit, and downstream verification. It is not required at runtime.

The bundled `.mjs` should run without requiring a source tree. If dependencies such as `iconv-lite` are needed at runtime, the bundle process should either embed them or otherwise make the runtime dependency contract explicit.

Release asset naming:

```text
miku-grep-<version>.mjs
miku-grep-sources-<version>.tgz
```

Release smoke test:

```bash
node miku-grep-<version>.mjs --version
```

## Development Notes

Recommended development shape:

```text
package.json
scripts/
  build-cli-bundle.mjs
  bundle-smoke.mjs
  stdio-example.mjs
src/
  main.ts
  public-types.ts
  internal-types.ts
  types.ts
  bundle-entry.ts
test/
  cli-meta.test.ts
  validation.test.ts
  search-content.test.ts
  search-filename.test.ts
  encoding-diagnostics.test.ts
  limits.test.ts
  helpers.ts
workplace/
```

Development source files may be split as needed. The current Node implementation uses `src/main.ts` as the CLI entry module, `src/public-types.ts` for public request/result types, `src/internal-types.ts` for implementation-only types, `src/types.ts` as a compatibility re-export facade, and `src/bundle-entry.ts` as the single-file bundle entry.

The npm package `bin` entry points to `dist/main.js`.

The distribution/runtime artifact should be a single `.mjs` file: `bundle/miku-grep.mjs`.

`bundle/miku-grep-sources.tgz` should contain enough source files for rebuild, audit, and downstream verification.

Shift_JIS decoding should use `iconv-lite`. The package is MIT licensed and must be listed as a dependency when implementation begins.

`scripts/stdio-example.mjs` or an equivalent smoke script should demonstrate stdin request JSON / stdout result JSON operation.

`scripts/bundle-smoke.mjs` or an equivalent smoke script should verify the single-file runtime artifact, including `--version`, `--help`, stdin JSON execution, and source archive contents.

Verbose and progress messages must go to stderr. stdout is reserved for result JSON except for explicit meta commands such as `--version`.
