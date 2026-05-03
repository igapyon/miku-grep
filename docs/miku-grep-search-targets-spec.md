# miku-grep Search Targets Specification

## 目的

この文書は、`miku-grep` の検索対象指定を `search.target` から `search.targets` 配列へ整理し、file path、directory path、file content を自然に組み合わせられるようにする実装済み仕様をまとめる。

主な目的は、directory entry を検索・返せるようにし、`find` 代替として使いやすくすることである。

## 背景

旧仕様では `search.target` に次の値を指定していた。

```text
content
filename
both
```

このうち `filename` は basename ではなく `request.root` からの相対 file path を検索する。これは機能としては file path search だが、名前としては生成AI agent や利用者に誤解されやすい。

また、旧仕様では directory entry 自体を match result として返さなかった。`find` 代替として使うには、file path だけでなく directory path も検索対象にできる必要がある。

下方互換性は考慮不要とし、実装済み仕様では `search.target` の単一 enum ではなく、`search.targets` 配列で検索対象を明示する。

## 方針

- `search.target` は廃止する。
- `search.targets` を採用する。
- `filename` は廃止し、`filepath` を採用する。
- `both` は廃止し、複数 target は配列で表現する。
- directory entry を match result として返せるようにする。
- `output.mode: "file-summary"` は、directory match を扱えるよう `summary` へ改名する。
- `output.mode: "detail"` は維持する。

## request JSON

### content search

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "RepositoryMap"
  },
  "search": {
    "targets": ["content"]
  }
}
```

### filepath search

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "security"
  },
  "search": {
    "targets": ["filepath"]
  }
}
```

### directory search

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "docs"
  },
  "search": {
    "targets": ["directory"]
  }
}
```

### find-like path search

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "test"
  },
  "search": {
    "targets": ["filepath", "directory"]
  }
}
```

### filepath and content search

旧 `both` 相当は配列で表現する。

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "encoding"
  },
  "search": {
    "targets": ["filepath", "content"]
  }
}
```

### all targets

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "RepositoryMap"
  },
  "search": {
    "targets": ["filepath", "directory", "content"]
  }
}
```

## target values

```text
filepath
  request.root-relative file path を検索する

directory
  request.root-relative directory path を検索する

content
  file content を検索する
```

`targets` は 1 個以上の配列とする。

重複した target は validation error とする。

未知 target は validation error とする。

`targets` 未指定時の default は `["content"]` である。

## output mode

現行の `file-summary` は、directory match を扱うと名前が合わなくなる。

実装済み仕様では次の mode を使う。

```text
summary
  path / file 単位でまとめる

detail
  hit 単位で返す
```

`summary` は旧 `file-summary` 相当だが、directory item も返せる。

## detail mode result

`content` target の `detail` mode は 1 content hit = 1 item を返す。

`filepath` / `directory` target の `detail` mode は 1 matched path = 最大 1 item を返す。同じ path 文字列内で query が複数回 match する場合、代表 match を 1 件だけ返す。

代表 `matchedText` は次の優先順位で選ぶ。

```text
1. 最初の non-empty match
2. non-empty match がなければ最初の zero-length match
```

このため、regex `.*` で path 一覧を取得しても、末尾の zero-length match によって同じ file / directory が複数 item になることはない。

### filepath match

```json
{
  "type": "filepath",
  "file": "src/main.ts",
  "matchedText": "src/main.ts"
}
```

### directory match

```json
{
  "type": "directory",
  "path": "src",
  "matchedText": "src"
}
```

### content match

```json
{
  "type": "content",
  "file": "src/main.ts",
  "line": 42,
  "column": 7,
  "matchedText": "RepositoryMap",
  "text": "class RepositoryMap {",
  "trimmed": false,
  "encoding": "utf-8",
  "encodingRule": {
    "type": "default",
    "pattern": null
  }
}
```

## summary mode result

### filepath / content matched file

```json
{
  "type": "file",
  "file": "src/main.ts",
  "matchTypes": ["filepath", "content"],
  "filepathMatched": true,
  "contentMatched": true,
  "lines": [42],
  "matchCount": 2,
  "snippets": [
    {
      "type": "content",
      "line": 42,
      "text": "class RepositoryMap {",
      "trimmed": false
    }
  ],
  "encoding": "utf-8",
  "encodingRule": {
    "type": "default",
    "pattern": null
  }
}
```

### directory match

```json
{
  "type": "directory",
  "path": "src",
  "matchTypes": ["directory"],
  "directoryMatched": true,
  "matchCount": 1
}
```

## summary fields

現行 summary は file 中心である。

directory search を入れる場合、次の field 追加を検討する。

```json
{
  "summary": {
    "filesVisited": 140,
    "directoriesVisited": 20,
    "filesScanned": 120,
    "directoriesScanned": 18,
    "filesMatched": 3,
    "directoriesMatched": 2,
    "matches": 8,
    "diagnostics": 0,
    "truncated": false,
    "truncatedReason": null
  }
}
```

意味:

```text
directoriesVisited
  traversal で見た directory 数

directoriesScanned
  directory path matching の対象になった directory 数

directoriesMatched
  directory target で hit した directory 数
```

`content` target では directory content を読まない。

## traversal / exclude との関係

既存の traversal 方針を維持する。

- `request.root` の realpath を検索境界として扱う。
- root 外へ解決される path は skip し、diagnostics に返す。
- symlink は MVP では追跡しない。
- `recursive` / `maxDepth` を適用する。
- `maxFilesVisited` / `maxDirectoriesVisited` を適用する。
- default exclude preset を適用する。

directory target を検索する場合でも、exclude された directory は match result に返さない。

`excludeDirNamePatterns` は traversal と directory target の両方に影響する。

`includeFileNamePatterns` / `excludeFileNamePatterns` は file path candidates に適用する。

directory の include pattern は MVP では未実装であり、後続検討とする。候補:

```json
{
  "search": {
    "includeDirNamePatterns": ["docs", "src"],
    "excludeDirNamePatterns": ["node_modules"]
  }
}
```

ただし MVP では `excludeDirNamePatterns` のみで開始し、directory include は後続検討でもよい。

## sort order

stable order を維持する。

実装済み方針:

```text
path asc
type order: directory, filepath, content
line asc for content
```

directory と file が同じ path prefix を持つ場合でも、path string の昇順を基本にする。

## validation error codes

追加 code:

```text
invalid_search_targets
invalid_search_target
duplicate_search_target
invalid_output_mode
```

`invalid_search_targets` は `search.targets` 自体が non-empty string array ではない場合に使う。

`invalid_search_target` は `search.targets[]` の値が許可 target ではない場合に使う。

`duplicate_search_target` は `search.targets` に重複がある場合に使う。

## diagnostics

既存 diagnostics を基本的に利用する。

関連 code:

```text
directory_not_readable
symlink_skipped
path_escape_skipped
max_files_visited
max_directories_visited
```

directory search 専用 diagnostic は MVP では不要とする。

## 実装決定

- `targets` 未指定時の default は `["content"]` とする。
- `summary` mode の directory item は `type`、`path`、`matchTypes`、`directoryMatched`、`matchCount` を持つ。
- directory include pattern は MVP に含めない。
- summary field に `directoriesVisited`、`directoriesScanned`、`directoriesMatched` を追加する。
- `output.mode: "file-summary"` は廃止し、互換 alias は残さない。
- `search.target`、`filename`、`both` は廃止し、互換 alias は残さない。

## 判断メモ

生成AI agent が request JSON を自然に組み立てるには、単一 enum の `both` よりも `targets` 配列の方が分かりやすい。

`filename` は basename と誤解されやすいため、root-relative file path を表す名前として `filepath` を使う方がよい。

`find` 代替は `targets: ["filepath", "directory"]` として表現できる。

検索対象を組み合わせたい場合も、`targets` 配列なら新しい複合 enum を増やさずに済む。
