# miku-grep CLI Specification v20260502

## Purpose

`miku-grep` is a local-first repository search CLI for generative AI agents and automation.

The tool is a grep replacement focused on finding files and snippets that an agent should read next. It returns structured JSON, diagnostics, and summaries instead of human-oriented plain text.

`miku-grep` is not a semantic retrieve tool. It does not perform embedding
search or ranking by meaning.

The next design direction is to strengthen the agent workflow around
repository search: list candidate files, search with fewer casing mistakes,
summarize likely next-read files, and hand off selected paths to read tools.
Because the current user base is still small, the project may prefer a cleaner
agent-oriented request / result shape over strict backward compatibility when
the two conflict.

## Scope

MVP scope:

- Node CLI
- `--version`
- stdin JSON request
- stdout JSON result
- `filepath` / `directory` / `content`
- `literal` / `regex` / `glob`
- glob-based include / exclude
- recursive search with `maxDepth`
- `utf-8` / `shift_jis`
- encoding rules
- diagnostics
- `detail` / `summary`

Out of scope for MVP:

- semantic retrieve
- MCP
- Java CLI
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
  "mode": "search",
  "query": {
    "type": "literal",
    "text": "RepositoryMap",
    "case": "sensitive"
  },
  "search": {
    "targets": ["content"],
    "recursive": true,
    "maxDepth": 8,
    "includeFileNamePatterns": ["*.java", "*.md"],
    "excludeFileNamePatterns": ["*.generated.md"],
    "excludeDirNamePatterns": ["tmp"]
  },
  "output": {
    "mode": "detail",
    "sort": "path",
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
  },
  "ignore": {
    "mode": "auto",
    "sources": [".gitignore", ".ignore", ".git/info/exclude"],
    "useGlobalGitignore": false
  }
}
```

### root

`root` is the search entry point.

If `root` is a relative path, it is resolved from the CLI process current working directory.

By default, the implementation searches only under `request.root`.

When top-level `detectGitRoot: true` is specified, the tool searches upward from
`request.root` for `.git`, uses that directory as the effective root, and
returns metadata that makes the requested root and effective root clear. This is
intended to reduce missed files when an agent invokes the CLI from a
subdirectory. The feature preserves the security rule that result paths are
relative and absolute local paths are not leaked as normal match values.

`effectiveRequest.requestedRoot` contains the input root. `effectiveRequest.root`
contains the effective root used for traversal.

Result `file` values are relative paths from `request.root`. Absolute paths must not be returned in result JSON.

Result paths must use `/` as the path separator on every platform, including Windows.

The implementation should resolve `request.root` with realpath semantics and treat that realpath as the search boundary. During traversal, if a directory or file resolves outside the root realpath, it must be skipped and reported as a diagnostic instead of being read.

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
  "text": "RepositoryMap",
  "case": "sensitive"
}
```

`query.type` values:

```text
literal
  literal string search

regex
  regular expression search

glob
  path glob search
```

`query.type: "literal"` uses simple substring matching.

```text
String.includes equivalent
no Unicode normalization
no locale-aware comparison
```

`query.type: "regex"` affects only search query interpretation. It does not change include / exclude pattern handling.

Search is case-sensitive by default.

`query.case` values:

```text
sensitive
  default

insensitive
  match without requiring the same uppercase / lowercase spelling
```

Prefer `query.case` over boolean names such as `caseSensitive` or `ignoreCase`
because it leaves room for future explicit modes while keeping the request easy
for agents to generate.

MVP Node CLI uses Node.js `RegExp` for `query.type: "regex"`.

Content regex search is applied line by line. Multi-line regex matching is outside MVP.

The request schema should not expose JavaScript-specific regex flags directly.
For `query.case: "insensitive"`, the Node implementation uses
case-insensitive matching internally. The public behavior is documented in
portable terms so a future Java CLI can implement the same intent.

Regex pattern text must not exceed 1000 characters.

Implementations should reject common ReDoS-prone nested quantified groups, such as `(.+)+` or `(a*)+`, as `unsafe_regex`.

A future Java CLI may use Java's regex engine. Cross-runtime regex behavior is not guaranteed to be identical for all edge cases. Prefer portable basic regex patterns when the same request should work across Node and Java runtimes.

`query.type: "glob"` searches root-relative paths. It supports path inventory
queries such as:

```text
**/*.md
src/**/*.ts
**/README.md
**/package.json
**/pom.xml
```

This glob query is separate from the existing basename include / exclude globs.
It supports path-level `**` matching. In `search` mode it is valid only with
`filepath` and `directory` targets; combining it with `content` target is a
validation error. In `listFiles` mode it filters listed file paths.

### mode

Top-level `mode` values:

```text
search
  grep-like repository search; query is required

listFiles
  JSON file inventory; query is not required
```

`mode: "listFiles"` should behave like an agent-readable `rg --files` entry
point. It respects the same root boundary, ignore files, default excludes,
resource limits, deterministic path formatting, and diagnostics policy as
search mode.

The result should include:

- file path list, relative to the effective root
- extension summary
- directory summary
- file count summary
- diagnostics for skipped or unreadable paths

The result uses dedicated top-level `files[]` and `fileSummary` fields. It does
not represent file inventory rows as grep matches, so `matches[]` is empty in
`listFiles` mode.

### search

`search.targets` is a non-empty array. Allowed values:

```text
filepath
  search request.root-relative file paths

directory
  search request.root-relative directory paths

content
  search file contents
```

Examples:

```json
{ "targets": ["content"] }
{ "targets": ["filepath"] }
{ "targets": ["directory"] }
{ "targets": ["filepath", "directory"] }
{ "targets": ["filepath", "content"] }
```

`filepath` searches the request.root-relative file path, not only the basename.

`directory` searches request.root-relative directory paths. Directory contents are not read.

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
  "maxFileBytes": 10485760,
  "maxLineChars": 1000000,
  "maxFilesVisited": 100000,
  "maxDirectoriesVisited": 10000
}
```

### traversal resource limits

`search.maxFilesVisited` limits the number of files discovered by traversal before include / exclude and binary skip.

Default: `100000`

Maximum: `1000000`

`search.maxDirectoriesVisited` limits the number of directories entered by traversal.

Default: `10000`

Maximum: `100000`

### maxLineChars

`search.maxLineChars` limits the number of decoded characters searched from a single line.

Default: `1000000`

Maximum: `10000000`

Lines longer than `search.maxLineChars` are skipped for content search and reported in `diagnostics[]`.

### include / exclude

`includeFileNamePatterns`, `excludeFileNamePatterns`, and `excludeDirNamePatterns` are glob patterns.

These are separate from `query.type: "regex"` and `query.type: "glob"`.

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

MVP applies the default exclude preset when `excludeFileNamePatterns` or `excludeDirNamePatterns` is omitted.

Request `excludeFileNamePatterns` and `excludeDirNamePatterns` replace the corresponding default exclude preset when specified.

Missing or empty `includeFileNamePatterns` means no include restriction.

Missing `excludeFileNamePatterns` means the default file exclude preset is used.

Empty `excludeFileNamePatterns` means no file name excludes.

Missing `excludeDirNamePatterns` means the default directory exclude preset is used.

Empty `excludeDirNamePatterns` means no directory name excludes.

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
2. Effective excludeDirNamePatterns is applied to directory basenames.
3. Effective excludeFileNamePatterns is applied to file basenames.
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
3. encoding.preset expanded rules
4. encoding.default
5. tool default utf-8
```

Encoding defaults:

```text
encoding.default
  utf-8

encoding.rules
  []

encoding.preset
  optional
  supported value: japanese-legacy

encoding.onDecodeError
  skip
```

`encoding.preset: "japanese-legacy"` applies Shift_JIS to common Japanese
legacy text file patterns after explicit `encoding.rules`. It is not automatic
encoding detection. Diagnostics and result items return `encodingRule` so the
actual encoding decision is traceable.

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

MVP treats files as binary when the file content contains a NUL byte during content search.

The default file exclude preset excludes common binary-like file name patterns, such as `*.class`, `*.jar`, `*.zip`, `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, and `*.pdf`, before content scanning unless `excludeFileNamePatterns` is specified and replaces that preset.

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

## Ignore Files

MVP respects repository ignore files by default.

```json
{
  "ignore": {
    "mode": "auto",
    "sources": [".gitignore", ".ignore", ".git/info/exclude"],
    "useGlobalGitignore": false
  }
}
```

Field meanings:

```text
mode
  auto | none
  Default is auto.
  auto reads configured ignore sources when they exist under request.root.
  none disables ignore file handling.

sources
  Optional source selector.
  Allowed values: .gitignore, .ignore, .git/info/exclude.
  Default is [".gitignore", ".ignore", ".git/info/exclude"].

useGlobalGitignore
  MVP accepts only false.
  Global gitignore is outside MVP because it makes results environment-dependent.
```

`.gitignore` and `.ignore` are applied per directory. A nested ignore file applies only to that directory and its descendants.

`.git/info/exclude` is read only when `request.root/.git/info/exclude` exists. MVP does not auto-detect a parent Git root.

Ignore file skips are combined with `excludeFileNamePatterns`, `excludeDirNamePatterns`, and default exclude presets using OR semantics. Setting `excludeFileNamePatterns: []` or `excludeDirNamePatterns: []` does not disable ignore files; use `ignore.mode: "none"` for that.

MVP supports a subset of Git ignore patterns:

```text
blank lines and # comments
foo
foo/
*.log
build/*.tmp
/build
docs/**/*.tmp
!important.log
  negation / unignore; later matching rules override earlier matching rules
```

MVP supports negation / unignore for the same pattern subset. If a directory is
ignored, files below it cannot be restored unless the parent directory itself is
also unignored, because traversal does not enter ignored directories.

MVP does not support escaped leading `#` or `!`, Git-compatible trailing-space
escaping, character classes, or brace expansion. Unsupported patterns are
skipped individually and reported as `unsupported_ignore_pattern`.

## Result JSON

### Output Defaults

When `output` is omitted or partially specified, MVP applies these defaults.

```json
{
  "mode": "summary",
  "sort": "path",
  "maxMatches": 200,
  "maxMatchesPerFile": 20,
  "maxLineLength": 240,
  "maxSnippetsPerFile": 3,
  "includeReadfileRequestHints": false,
  "contextLinesBefore": 0,
  "contextLinesAfter": 0
}
```

Field meanings:

```text
mode
  Default is summary because agents usually need to narrow candidate files first.

sort
  "path" or "relevance".
  Default is path.
  Relevance sort is a deterministic heuristic for summary and agent candidates,
  not semantic ranking.

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
  Maximum number of representative snippets in summary mode.
  Must not exceed 100.

includeReadfileRequestHints
  Boolean.
  Default is false.
  When true, result JSON includes readfileHints for matched files.

contextLines
  Detail mode only.
  Shorthand for setting contextLinesBefore and contextLinesAfter to the same value.
  Cannot be combined with contextLinesBefore or contextLinesAfter.
  Must not exceed 20.

contextLinesBefore
  Detail mode only.
  Number of lines to return before each content hit.
  Must not exceed 20.

contextLinesAfter
  Detail mode only.
  Number of lines to return after each content hit.
  Must not exceed 20.
```

Allowed `output.mode` values:

```text
detail
summary
agent
```

Any other `output.mode` is a validation error.

```text
agent
  file / directory candidate summary optimized for choosing the next file to
  read, including representative snippets and read range hints
```

`output.includeReadfileRequestHints: true` adds handoff hints that can be used
to call `miku-readfile` for selected files.

Successful result example:

```json
{
  "version": 1,
  "ok": true,
  "error": null,
  "effectiveRequest": {
    "requestedRoot": ".",
    "root": ".",
    "detectGitRoot": false,
    "mode": "search",
    "query": {
      "type": "literal",
      "text": "RepositoryMap",
      "case": "sensitive"
    },
    "search": {
      "targets": ["content"],
      "recursive": true,
      "maxDepth": 8,
      "maxFileBytes": 10485760,
      "maxLineChars": 1000000,
      "maxFilesVisited": 100000,
      "maxDirectoriesVisited": 10000,
      "includeFileNamePatterns": ["*.java", "*.md"],
      "excludeFileNamePatterns": ["*.generated.md"],
      "excludeDirNamePatterns": ["tmp"]
    },
    "output": {
      "mode": "detail",
      "sort": "path",
      "maxMatches": 200,
      "maxMatchesPerFile": 20,
      "maxLineLength": 240,
      "maxSnippetsPerFile": 3,
      "includeReadfileRequestHints": false,
      "contextLinesBefore": 0,
      "contextLinesAfter": 0
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
    },
    "ignore": {
      "mode": "auto",
      "sources": [".gitignore", ".ignore", ".git/info/exclude"],
      "useGlobalGitignore": false,
      "loadedSources": []
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
    "directoriesVisited": 12,
    "filesScanned": 120,
    "directoriesScanned": 0,
    "filesMatched": 3,
    "directoriesMatched": 0,
    "filesIgnored": 0,
    "directoriesIgnored": 0,
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
    "requestedRoot": "./private-repo",
    "root": "./private-repo",
    "detectGitRoot": false,
    "mode": "search",
    "query": {
      "type": "literal",
      "text": "RepositoryMap",
      "case": "sensitive"
    },
    "search": {
      "targets": ["content"],
      "recursive": true,
      "maxDepth": 8,
      "maxFileBytes": 10485760,
      "maxLineChars": 1000000,
      "maxFilesVisited": 100000,
      "maxDirectoriesVisited": 10000
    },
    "output": {
      "mode": "detail",
      "sort": "path",
      "maxMatches": 200,
      "maxMatchesPerFile": 20,
      "maxLineLength": 240,
      "maxSnippetsPerFile": 3,
      "includeReadfileRequestHints": false,
      "contextLinesBefore": 0,
      "contextLinesAfter": 0
    },
    "encoding": {
      "default": "utf-8",
      "rules": [],
      "onDecodeError": "skip"
    },
    "ignore": {
      "mode": "auto",
      "sources": [".gitignore", ".ignore", ".git/info/exclude"],
      "useGlobalGitignore": false,
      "loadedSources": []
    }
  },
  "matches": [],
  "summary": {
    "filesVisited": 0,
    "directoriesVisited": 0,
    "filesScanned": 0,
    "directoriesScanned": 0,
    "filesMatched": 0,
    "directoriesMatched": 0,
    "filesIgnored": 0,
    "directoriesIgnored": 0,
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

## File Inventory

`mode: "listFiles"` returns file inventory data in dedicated result fields:

```json
{
  "version": 1,
  "ok": true,
  "error": null,
  "effectiveRequest": {
    "requestedRoot": ".",
    "root": ".",
    "detectGitRoot": false,
    "mode": "listFiles"
  },
  "matches": [],
  "files": [
    {
      "path": "README.md",
      "extension": ".md",
      "directory": "."
    },
    {
      "path": "src/main.ts",
      "extension": ".ts",
      "directory": "src"
    }
  ],
  "fileSummary": {
    "files": 2,
    "extensions": [
      {
        "extension": ".md",
        "count": 1
      },
      {
        "extension": ".ts",
        "count": 1
      }
    ],
    "directories": [
      {
        "path": ".",
        "count": 1
      },
      {
        "path": "src",
        "count": 1
      }
    ]
  },
  "summary": {
    "filesVisited": 2,
    "directoriesVisited": 2,
    "filesScanned": 2,
    "directoriesScanned": 0,
    "filesMatched": 0,
    "directoriesMatched": 0,
    "filesIgnored": 0,
    "directoriesIgnored": 0,
    "matches": 0,
    "diagnostics": 0,
    "truncated": false,
    "truncatedReason": null
  },
  "diagnostics": []
}
```

`files[]` is sorted by root-relative path using the same deterministic path
ordering as search results.

### detail

`detail` returns one item per content hit for `content` targets.

For `filepath` and `directory` targets, `detail` returns at most one item per matched path. If the query has multiple matches in the same path string, the returned item uses a representative `matchedText`.

Representative path `matchedText` selection:

```text
1. first non-empty match
2. first zero-length match when there is no non-empty match
```

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

Content hit with context:

```json
{
  "type": "content",
  "file": "src/main/java/example/App.java",
  "line": 42,
  "column": 7,
  "matchedText": "RepositoryMap",
  "text": "class RepositoryMap {",
  "trimmed": false,
  "contextBefore": [
    {
      "line": 41,
      "text": "public class App {",
      "trimmed": false
    }
  ],
  "contextAfter": [
    {
      "line": 43,
      "text": "}",
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

`contextBefore` and `contextAfter` are returned only for content hits in detail mode when context lines are requested.
Context line text uses `output.maxLineLength`.
If a context line exceeds `search.maxLineChars`, that line is omitted and reported in `diagnostics[]`.
Context lines do not count toward `summary.matches`, `output.maxMatches`, or `output.maxMatchesPerFile`.

Filepath hit:

```json
{
  "type": "filepath",
  "file": "src/main/java/example/RepositoryMap.java",
  "matchedText": "src/main/java/example/RepositoryMap.java"
}
```

Directory hit:

```json
{
  "type": "directory",
  "path": "src/main/java",
  "matchedText": "java"
}
```

### agent

`agent` returns candidate-oriented items in `matches[]`.

File candidate:

```json
{
  "type": "agentFile",
  "file": "src/main.ts",
  "targetKind": "file",
  "matchTypes": ["content"],
  "matchCount": 1,
  "lines": [42],
  "representativeSnippets": [
    {
      "type": "content",
      "line": 42,
      "text": "class RepositoryMap {",
      "trimmed": false
    }
  ],
  "readRanges": [
    {
      "startLine": 37,
      "endLine": 47,
      "reason": "match"
    }
  ],
  "encoding": "utf-8",
  "encodingRule": {
    "type": "default"
  }
}
```

Directory candidate:

```json
{
  "type": "agentDirectory",
  "path": "docs",
  "targetKind": "directory",
  "matchTypes": ["directory"],
  "matchCount": 1
}
```

`readRanges` are suggestions for the next file-read operation. They are not
line-boundary guarantees; a downstream reader should clamp them to the file's
actual line count.

## Readfile Hints

When `output.includeReadfileRequestHints: true`, result JSON includes
`readfileHints[]` for matched files.

```json
{
  "file": "src/main.ts",
  "request": {
    "version": 1,
    "root": ".",
    "files": [
      {
        "path": "src/main.ts"
      }
    ]
  }
}
```

Hints are generated from file-bearing match items: `filepath`, `content`,
`file`, and `agentFile`. Directory-only matches do not produce readfile hints.
Each file appears at most once.

### summary

`summary` returns one item per matched file or matched directory.

```json
{
  "type": "file",
  "file": "src/main/java/example/RepositoryMap.java",
  "matchTypes": ["filepath", "content"],
  "filepathMatched": true,
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

Directory summary item:

```json
{
  "type": "directory",
  "path": "src/main/java",
  "matchTypes": ["directory"],
  "directoryMatched": true,
  "matchCount": 1
}
```

Filepath match, directory match, and content match are identified by `type`. Do not add `matchType`.

```text
detail mode
  type: "filepath"
  type: "directory"
  type: "content"

summary mode
  type: "file"
  matchTypes: ["filepath", "content"]
  filepathMatched: true | false
  contentMatched: true | false

  type: "directory"
  matchTypes: ["directory"]
  directoryMatched: true
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

max_line_chars_exceeded
  line exceeded search.maxLineChars and was skipped

binary_file_skipped
  file was treated as binary and skipped during content search

decode_error
  file could not be decoded with the applied encoding rule and was skipped

path_escape_skipped
  path resolved outside request.root realpath and was skipped

ignore_file_not_readable
  ignore file exists but could not be read

unsupported_ignore_pattern
  ignore pattern is outside the MVP subset and was skipped

max_matches
  search stopped because output.maxMatches was reached

max_matches_per_file
  search for a file stopped because output.maxMatchesPerFile was reached

max_snippets_per_file
  summary snippets were omitted because output.maxSnippetsPerFile was reached

max_files_visited
  search stopped because search.maxFilesVisited was reached

max_directories_visited
  search stopped because search.maxDirectoriesVisited was reached
```

## Summary

`summary` lets agents and scripts judge result size, scanned range, and truncation.

```json
{
  "filesVisited": 140,
  "directoriesVisited": 20,
  "filesScanned": 98,
  "directoriesScanned": 18,
  "filesMatched": 3,
  "directoriesMatched": 2,
  "filesIgnored": 4,
  "directoriesIgnored": 1,
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
  For filepath search, this means files checked by file path matching.

directoriesVisited
  Number of directories discovered by traversal, including the root directory.

directoriesScanned
  Number of directories checked by directory path matching.

filesMatched
  Number of files with at least one hit.

directoriesMatched
  Number of directories with at least one hit.

filesIgnored
  Number of files skipped by ignore file patterns.
  Does not include default exclude preset or explicit exclude pattern skips.

directoriesIgnored
  Number of directories skipped by ignore file patterns.
  Does not include default exclude preset or explicit exclude pattern skips.

matches
  Total hit count.
  For filepath and directory targets, multiple query matches in the same path count as one representative hit.
  In detail mode this usually equals matches[] length.
  In summary mode this may differ from matches[] length.

diagnostics
  diagnostics[] item count.

truncated
  true when result is omitted or search is stopped by limits.

truncatedReason
  Main truncation reason when truncated is true.
  Candidate values: max_matches / max_matches_per_file / max_line_length / max_snippets_per_file / max_line_chars_exceeded / max_files_visited / max_directories_visited
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
- `maxLineChars` is too large
- `maxFilesVisited` is too large
- `maxDirectoriesVisited` is too large
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
invalid_mode
invalid_query_type
invalid_query_case
invalid_search_targets
invalid_search_target
duplicate_search_target
invalid_output_mode
invalid_output_sort
invalid_context_lines
invalid_ignore_mode
invalid_ignore_sources
invalid_ignore_source
invalid_ignore_global
invalid_regex
regex_too_large
unsafe_regex
root_not_found
root_not_accessible
root_too_broad
empty_query
max_matches_too_large
max_matches_per_file_too_large
max_depth_too_large
max_line_chars_too_large
max_files_visited_too_large
max_directories_visited_too_large
max_line_length_too_large
max_snippets_per_file_too_large
context_lines_too_large
max_file_bytes_too_large
invalid_encoding
invalid_encoding_preset
invalid_encoding_rule
```

## Sort

MVP output should be stable.

File traversal and matched files are sorted by request.root-relative file path ascending where practical.

All path and diagnostic-code string ordering uses deterministic UTF-16 code unit order, equivalent to Java `String.compareTo`, and must not use locale-aware collation.

Content hits are sorted by line ascending within each file.

When `search.targets` produces both filepath and content hits for the same file in `detail` mode, filepath hits should appear before content hits for that file. Directory hits are sorted with other matches by path.

Diagnostics should be emitted in stable order where practical. Prefer path / file ascending, then line ascending when present, then code ascending.

`effectiveRequest` should be serialized with stable key order matching the documented request shape.

Default match sort order:

```text
file path asc
line asc
```

`output.sort` values:

```text
path
  default deterministic path order

relevance
  deterministic heuristic order for summary and agent candidates
```

`output.sort: "relevance"` is not semantic ranking. It scores candidates using
observable repository-search signals such as filepath match, content match,
match count, README / docs / src / test path hints, and generated / vendor-like
path demotion. Items returned from `summary` and `agent` mode include
`relevance.score` and `relevance.reasons` so agents can inspect why a candidate
was promoted or demoted.

`detail` mode keeps path / line ordering because the one-hit-per-item result is
intended for exact hit inspection.

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
