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
    "query": { "type": "literal", "text": "RepositoryMap" },
    "search": { "target": "content", "recursive": true, "maxDepth": 8 }
  }

REQUEST FIELDS
  root
    Search entry directory. Relative paths are resolved from current working directory.
    Result file paths are root-relative and always use "/".

  query.type
    "literal" or "regex".
    literal is case-sensitive substring search.
    regex uses Node.js RegExp, line by line for content search. Regex flags are not accepted.

  query.text
    Non-empty search text or regex pattern.

  search.target
    "content" searches file contents.
    "filename" searches root-relative file paths.
    "both" searches filename first, then content.
    Default: "content".

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
    Optional additional basename glob excludes.
    Default excludes are always applied.

  search.excludeDirNamePatterns
    Optional additional directory basename glob excludes.
    Default excludes are always applied.

  output.mode
    "file-summary" or "detail". Default: "file-summary".

  output.maxMatches
    Default: 200. Maximum: 10000.

  output.maxMatchesPerFile
    Default: 20. Maximum: 1000.

  output.maxLineLength
    Returned snippet limit. Default: 240. Maximum: 4000.
    Snippets contain only source text. Artificial "..." is not added.

  output.maxSnippetsPerFile
    file-summary representative snippet limit. Default: 3. Maximum: 100.

  encoding.default
    "utf-8" or "shift_jis". Default: "utf-8".

  encoding.rules
    Array of { "pathPattern": "...", "encoding": "..." } or
    { "fileNamePattern": "...", "encoding": "..." }.
    pathPattern rules take priority over fileNamePattern rules.

  encoding.onDecodeError
    "skip". Decode failures are reported in diagnostics.

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
    "summary": {
      "filesVisited": 0,
      "filesScanned": 0,
      "filesMatched": 0,
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
      "query": { "type": "literal", "text": "RepositoryMap" },
      "search": {
        "target": "content",
        "recursive": true,
        "maxDepth": 8,
        "includeFileNamePatterns": ["*.java", "*.md"]
      },
      "output": { "mode": "file-summary", "maxMatches": 20 }
    }

  Possible successful output:
    {
      "version": 1,
      "ok": true,
      "error": null,
      "effectiveRequest": {
        "root": ".",
        "query": { "type": "literal", "text": "RepositoryMap" },
        "search": {
          "target": "content",
          "recursive": true,
          "maxDepth": 8,
          "maxFileBytes": 10485760,
          "includeFileNamePatterns": ["*.java", "*.md"],
          "excludeFileNamePatterns": ["*.class", "*.jar", "*.zip", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.pdf", ".classpath", ".project"],
          "excludeDirNamePatterns": [".git", ".svn", "node_modules", "target", "build", "dist", ".gradle", ".idea", ".vscode", ".settings", "vendor"]
        },
        "output": { "mode": "file-summary", "maxMatches": 20, "maxMatchesPerFile": 20, "maxLineLength": 240, "maxSnippetsPerFile": 3 },
        "encoding": { "default": "utf-8", "rules": [], "onDecodeError": "skip" }
      },
      "matches": [
        {
          "type": "file",
          "file": "src/RepositoryMap.java",
          "matchTypes": ["content"],
          "filenameMatched": false,
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
      "summary": { "filesVisited": 12, "filesScanned": 10, "filesMatched": 1, "matches": 1, "diagnostics": 0, "truncated": false, "truncatedReason": null },
      "diagnostics": []
    }

  Possible validation error output:
    {
      "version": 1,
      "ok": false,
      "error": { "code": "empty_query", "message": "query.text must not be empty" },
      "effectiveRequest": {},
      "matches": [],
      "summary": { "filesVisited": 0, "filesScanned": 0, "filesMatched": 0, "matches": 0, "diagnostics": 1, "truncated": false, "truncatedReason": null },
      "diagnostics": [
        { "severity": "error", "code": "empty_query", "message": "query.text must not be empty" }
      ]
    }

DETAIL MATCHES
  Content hit:
    { "type": "content", "file": "src/App.java", "line": 42, "column": 7,
      "matchedText": "RepositoryMap", "text": "class RepositoryMap {",
      "trimmed": false, "encoding": "utf-8", "encodingRule": { "type": "default" } }
  Filename hit:
    { "type": "filename", "file": "src/RepositoryMap.java",
      "matchedText": "src/RepositoryMap.java" }

FILE-SUMMARY MATCHES
  { "type": "file", "file": "src/RepositoryMap.java",
    "matchTypes": ["filename", "content"],
    "filenameMatched": true, "contentMatched": true,
    "lines": [42], "matchCount": 1, "snippets": [] }

COMMON DIAGNOSTIC CODES
  Validation / expected failures:
    invalid_request, unknown_field, invalid_version, invalid_query_type,
    invalid_search_target, invalid_output_mode, invalid_regex,
    regex_too_large, unsafe_regex,
    root_not_found, root_not_accessible, root_too_broad, empty_query,
    max_matches_too_large, max_matches_per_file_too_large, max_depth_too_large,
    max_line_length_too_large, max_snippets_per_file_too_large,
    max_file_bytes_too_large, max_line_chars_too_large, max_files_visited_too_large,
    max_directories_visited_too_large, invalid_encoding, invalid_encoding_rule
  Runtime diagnostics:
    directory_not_readable, symlink_skipped, file_not_readable,
    max_file_bytes_exceeded, binary_file_skipped, decode_error,
    path_escape_skipped, max_matches, max_matches_per_file,
    max_snippets_per_file, max_line_chars_exceeded,
    max_files_visited, max_directories_visited

EXAMPLES
  Content search:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"literal","text":"TODO"},"search":{"target":"content"}}' | miku-grep

  Filename search:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"regex","text":"Repository.*\\\\.java$"},"search":{"target":"filename"},"output":{"mode":"detail"}}' | miku-grep

SEE ALSO
  docs/miku-grep-cli-spec.md
`;
}
