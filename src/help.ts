export function helpText(): string {
  return `miku-grep - local-first structured grep CLI for AI agents and automation

USAGE
  miku-grep < request.json > result.json
  miku-grep --version
  miku-grep --help

CONTRACT
  Primary input is stdin JSON. Primary output is stdout JSON.
  stdout is reserved for result JSON except --version and --help.
  stderr is for usage errors, malformed stdin, progress, verbose logs, and unexpected runtime messages.
  Request JSON and result JSON use top-level "version": 1.
  Unknown request fields are validation errors.
  Result JSON is pretty-printed with 2-space indentation and a trailing newline.

EXIT CODES
  0  ok: true, or explicit meta command such as --version / --help
  1  ok: false expected failure with stdout result JSON when possible
  2  malformed stdin or CLI usage error
  3  unexpected runtime error

MINIMAL REQUEST
  {
    "version": 1,
    "root": ".",
    "query": { "type": "literal", "text": "RepositoryMap", "case": "sensitive" },
    "search": { "targets": ["content"], "recursive": true, "maxDepth": 8 }
  }

REQUEST FIELDS
  root
    Search entry directory. Relative paths are resolved from current working directory.
    Result file paths are root-relative and always use "/".

  detectGitRoot
    boolean. Default: false.
    When true, search upward from root for .git and use that directory as effective root.
    effectiveRequest.requestedRoot keeps the input root; effectiveRequest.root is the effective root.

  query.type
    "literal", "regex", or "glob".
    literal is substring search.
    regex uses Node.js RegExp, line by line for content search. Regex flags are not accepted directly.
    glob searches root-relative file or directory paths and supports path-level "**".

  query.text
    Non-empty search text or regex pattern.

  query.case
    "sensitive" or "insensitive". Default: "sensitive".
    In regex search, "insensitive" is implemented as case-insensitive matching.
    Ignored for glob search.

  mode
    "search" or "listFiles". Default: "search".
    "search" requires query.
    "listFiles" returns file inventory JSON and must not specify query.

  search.targets
    Non-empty array of "filepath", "directory", and/or "content".
    "filepath" searches root-relative file paths.
    "directory" searches root-relative directory paths.
    "content" searches file contents.
    Default: ["content"].

  search.recursive
    boolean. Default: true.

  search.maxDepth
    Default: 20 when recursive is true. Maximum: 50.

  search.maxFileBytes
    Content-read size limit. Default: 10485760. Maximum: 104857600.

  search.maxLineChars
    Per-line scan limit after decode. Default: 1000000. Maximum: 10000000.

  search.maxFilesVisited
    Traversal file visit limit. Default: 100000. Maximum: 1000000.

  search.maxDirectoriesVisited
    Traversal directory visit limit. Default: 10000. Maximum: 100000.

  search.includeFileNamePatterns
    Optional glob array. Empty or missing means no include restriction.
    MVP glob supports "*" and "?" within one basename.

  search.excludeFileNamePatterns
    Optional basename glob excludes.
    When omitted, default excludes are used.
    When specified, this value replaces default excludes.

  search.excludeDirNamePatterns
    Optional directory basename glob excludes.
    When omitted, default excludes are used.
    When specified, this value replaces default excludes.

  output.mode
    "summary", "detail", or "agent". Default: "summary".
    "agent" returns candidate-oriented matches with read range suggestions.

  output.maxMatches
    Default: 200. Maximum: 10000.

  output.maxMatchesPerFile
    Default: 20. Maximum: 1000.

  output.maxLineLength
    Returned snippet limit. Default: 240. Maximum: 4000.
    Snippets contain only source text. Artificial "..." is not added.

  output.maxSnippetsPerFile
    summary representative snippet limit. Default: 3. Maximum: 100.

  output.includeReadfileRequestHints
    boolean. Default: false.
    When true, result.readfileHints contains minimal miku-readfile requests for matched files.

  output.contextLines
    detail mode only. Shorthand for contextLinesBefore and contextLinesAfter.
    Default: 0. Maximum: 20.

  output.contextLinesBefore / output.contextLinesAfter
    detail mode only. Context lines around content hits.
    Default: 0. Maximum: 20.

  encoding.default
    "utf-8" or "shift_jis". Default: "utf-8".

  encoding.preset
    Optional. Currently "japanese-legacy".
    Applies Shift_JIS to common Japanese legacy text file patterns after explicit rules.

  encoding.rules
    Array of { "pathPattern": "...", "encoding": "..." } or
    { "fileNamePattern": "...", "encoding": "..." }.
    pathPattern rules take priority over fileNamePattern rules.

  encoding.onDecodeError
    "skip". Decode failures are reported in diagnostics.

  ignore.mode
    "auto" or "none". Default: "auto".
    "auto" respects .gitignore, .ignore, and .git/info/exclude under root.
    "none" disables ignore file handling.

  ignore.sources
    Optional source selector. Allowed values: ".gitignore", ".ignore", ".git/info/exclude".
    Default: [".gitignore", ".ignore", ".git/info/exclude"].

  ignore.useGlobalGitignore
    false. Global gitignore is outside MVP.

DEFAULT EXCLUDES
  Directory names:
    .git, .svn, node_modules, target, build, dist, .gradle, .idea, .vscode, .settings, vendor
  File name patterns:
    *.class, *.jar, *.zip, *.png, *.jpg, *.jpeg, *.gif, *.pdf, .classpath, .project

RESULT SHAPE
  {
    "version": 1,
    "ok": true,
    "error": null,
    "effectiveRequest": {},
    "matches": [],
    "files": [],
    "fileSummary": {},
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
      "diagnostics": 0,
      "truncated": false,
      "truncatedReason": null
    },
    "diagnostics": []
  }

FULL STDIN / STDOUT EXAMPLE
  Input:
    {
      "version": 1,
      "root": ".",
      "mode": "search",
      "query": { "type": "literal", "text": "RepositoryMap", "case": "sensitive" },
      "search": {
        "targets": ["content"],
        "recursive": true,
        "maxDepth": 8,
        "includeFileNamePatterns": ["*.java", "*.md"]
      },
      "output": { "mode": "summary", "maxMatches": 20 }
    }

  Possible successful output:
    {
      "version": 1,
      "ok": true,
      "error": null,
      "effectiveRequest": {
        "requestedRoot": ".",
        "root": ".",
        "detectGitRoot": false,
        "mode": "search",
        "query": { "type": "literal", "text": "RepositoryMap", "case": "sensitive" },
        "search": {
          "targets": ["content"],
          "recursive": true,
          "maxDepth": 8,
          "maxFileBytes": 10485760,
          "includeFileNamePatterns": ["*.java", "*.md"],
          "excludeFileNamePatterns": ["*.class", "*.jar", "*.zip", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.pdf", ".classpath", ".project"],
          "excludeDirNamePatterns": [".git", ".svn", "node_modules", "target", "build", "dist", ".gradle", ".idea", ".vscode", ".settings", "vendor"]
        },
        "output": { "mode": "summary", "maxMatches": 20, "maxMatchesPerFile": 20, "maxLineLength": 240, "maxSnippetsPerFile": 3, "includeReadfileRequestHints": false, "contextLinesBefore": 0, "contextLinesAfter": 0 },
        "encoding": { "default": "utf-8", "rules": [], "onDecodeError": "skip" },
        "ignore": { "mode": "auto", "sources": [".gitignore", ".ignore", ".git/info/exclude"], "useGlobalGitignore": false, "loadedSources": [] }
      },
      "matches": [
        {
          "type": "file",
          "file": "src/RepositoryMap.java",
          "matchTypes": ["content"],
          "filepathMatched": false,
          "contentMatched": true,
          "lines": [42],
          "matchCount": 1,
          "snippets": [
            { "type": "content", "line": 42, "text": "class RepositoryMap {", "trimmed": false }
          ],
          "encoding": "utf-8",
          "encodingRule": { "type": "default" }
        }
      ],
      "summary": { "filesVisited": 12, "directoriesVisited": 3, "filesScanned": 10, "directoriesScanned": 0, "filesMatched": 1, "directoriesMatched": 0, "filesIgnored": 0, "directoriesIgnored": 0, "matches": 1, "diagnostics": 0, "truncated": false, "truncatedReason": null },
      "diagnostics": []
    }

  Possible validation error output:
    {
      "version": 1,
      "ok": false,
      "error": { "code": "empty_query", "message": "query.text must not be empty" },
      "effectiveRequest": {},
      "matches": [],
      "summary": { "filesVisited": 0, "directoriesVisited": 0, "filesScanned": 0, "directoriesScanned": 0, "filesMatched": 0, "directoriesMatched": 0, "filesIgnored": 0, "directoriesIgnored": 0, "matches": 0, "diagnostics": 1, "truncated": false, "truncatedReason": null },
      "diagnostics": [
        { "severity": "error", "code": "empty_query", "message": "query.text must not be empty" }
      ]
    }

DETAIL MATCHES
  Content hit:
    { "type": "content", "file": "src/App.java", "line": 42, "column": 7,
      "matchedText": "RepositoryMap", "text": "class RepositoryMap {",
      "trimmed": false, "encoding": "utf-8", "encodingRule": { "type": "default" } }
  Content hit with context:
    { "type": "content", "file": "src/App.java", "line": 42, "column": 7,
      "matchedText": "RepositoryMap", "text": "class RepositoryMap {",
      "trimmed": false,
      "contextBefore": [{ "line": 41, "text": "", "trimmed": false }],
      "contextAfter": [{ "line": 43, "text": "}", "trimmed": false }],
      "encoding": "utf-8", "encodingRule": { "type": "default" } }
  Filepath hit:
    { "type": "filepath", "file": "src/RepositoryMap.java",
      "matchedText": "src/RepositoryMap.java" }
  Directory hit:
    { "type": "directory", "path": "src",
      "matchedText": "src" }

SUMMARY MATCHES
  { "type": "file", "file": "src/RepositoryMap.java",
    "matchTypes": ["filepath", "content"],
    "filepathMatched": true, "contentMatched": true,
    "lines": [42], "matchCount": 1, "snippets": [] }
  { "type": "directory", "path": "src",
    "matchTypes": ["directory"], "directoryMatched": true, "matchCount": 1 }

AGENT MATCHES
  { "type": "agentFile", "file": "src/RepositoryMap.java",
    "targetKind": "file", "matchTypes": ["content"], "matchCount": 1,
    "lines": [42], "representativeSnippets": [],
    "readRanges": [{ "startLine": 37, "endLine": 47, "reason": "match" }] }
  { "type": "agentDirectory", "path": "src",
    "targetKind": "directory", "matchTypes": ["directory"], "matchCount": 1 }

READFILE HINTS
  { "file": "src/RepositoryMap.java",
    "request": { "version": 1, "root": ".", "files": [{ "path": "src/RepositoryMap.java" }] } }

COMMON DIAGNOSTIC CODES
  Validation / expected failures:
    invalid_request, unknown_field, invalid_version, invalid_mode, invalid_query_type, invalid_query_case,
    invalid_search_targets, invalid_search_target, duplicate_search_target,
    invalid_output_mode, invalid_context_lines, invalid_regex,
    regex_too_large, unsafe_regex,
    invalid_ignore_mode, invalid_ignore_sources, invalid_ignore_source, invalid_ignore_global,
    root_not_found, root_not_accessible, root_too_broad, empty_query,
    max_matches_too_large, max_matches_per_file_too_large, max_depth_too_large,
    max_line_length_too_large, max_snippets_per_file_too_large,
    context_lines_too_large,
    max_file_bytes_too_large, max_line_chars_too_large, max_files_visited_too_large,
    max_directories_visited_too_large, invalid_encoding, invalid_encoding_preset, invalid_encoding_rule
  Runtime diagnostics:
    directory_not_readable, symlink_skipped, file_not_readable,
    max_file_bytes_exceeded, binary_file_skipped, decode_error,
    ignore_file_not_readable, unsupported_ignore_pattern,
    path_escape_skipped, max_matches, max_matches_per_file,
    max_snippets_per_file, max_line_chars_exceeded,
    max_files_visited, max_directories_visited

EXAMPLES
  Content search:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"literal","text":"TODO"},"search":{"targets":["content"]}}' | miku-grep

  Case-insensitive content search:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"literal","text":"repositorymap","case":"insensitive"},"search":{"targets":["content"]}}' | miku-grep

  File inventory:
    printf '%s\\n' '{"version":1,"root":".","mode":"listFiles"}' | miku-grep

  Glob path search:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"glob","text":"**/*.md"},"search":{"targets":["filepath"]}}' | miku-grep

  Agent summary:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"literal","text":"RepositoryMap"},"output":{"mode":"agent"}}' | miku-grep

  Search with readfile hints:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"literal","text":"RepositoryMap"},"output":{"includeReadfileRequestHints":true}}' | miku-grep

  Japanese legacy encoding preset:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"literal","text":"検索語"},"encoding":{"preset":"japanese-legacy"}}' | miku-grep

  Find-like path search:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"regex","text":"Repository|docs"},"search":{"targets":["filepath","directory"]},"output":{"mode":"detail"}}' | miku-grep

SEE ALSO
  docs/miku-grep-cli-spec.md
`;
}
