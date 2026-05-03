# miku-grep Ignore Files Specification

## 目的

この文書は、`miku-grep` が `.gitignore` などの ignore file を尊重し、通常の repository search で読まない file / directory を検索対象から除外するための実装済み仕様をまとめる。

主な目的は、生成AI agent が repository を検索するときに、build output、generated file、vendor copy、local scratch などを意図せず拾いすぎないようにすることである。

## 背景

ignore file 対応前は、`excludeFileNamePatterns` / `excludeDirNamePatterns` と default exclude preset により、`.git`、`node_modules`、`target`、`build`、`dist`、`vendor` などを除外していた。

しかし repository ごとの除外方針は `.gitignore` や `.ignore` に既に書かれていることが多い。これを読まない場合、次の問題が起きる。

- repository 固有の generated file を拾う
- local-only の scratch file を拾う
- vendor / build output の directory 名が default preset にない場合に拾う
- `find` 代替として path search したときに、通常 Git で無視される path も候補に出る

`miku-grep` は Git root auto detection をしないが、検索 root 配下にある ignore file は local repository の検索方針として扱える。

## 方針

- `ignore` request object を追加する。
- default は ignore file 尊重を有効にする。
- `ignore.mode` で有効 / 無効を制御する。
- MVP では `.gitignore` と `.ignore` を読む。
- `.git/info/exclude` は、`request.root` 配下に `.git/info/exclude` がある場合だけ読む。
- global gitignore は MVP では読まない。
- ignore file により除外された file / directory は match result に返さない。
- ignore file により除外された file / directory は content scan しない。
- ignore file により除外された件数を `summary` に返す。
- 実際に使った ignore source を `effectiveRequest.ignore.loadedSources` に返す。
- ignore file の unreadable / unsupported pattern は warning diagnostic とし、検索全体は継続する。

## request JSON

### default

`ignore` 未指定時は、ignore file を尊重する。

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

effective default:

```json
{
  "ignore": {
    "mode": "auto",
    "sources": [".gitignore", ".ignore", ".git/info/exclude"],
    "useGlobalGitignore": false
  }
}
```

### disable ignore files

ignore file を使わず、request の include / exclude と default exclude preset だけで検索したい場合は `mode: "none"` を指定する。

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
  },
  "ignore": {
    "mode": "none"
  }
}
```

### explicit sources

MVP では `sources` は固定候補の enable / disable だけに使う。任意 path の ignore file 指定は後続検討とする。

```json
{
  "ignore": {
    "mode": "auto",
    "sources": [".gitignore", ".ignore"]
  }
}
```

## request field

```text
ignore.mode
  auto | none

ignore.sources
  Optional array.
  Allowed values:
    .gitignore
    .ignore
    .git/info/exclude
  Default:
    [".gitignore", ".ignore", ".git/info/exclude"]

ignore.useGlobalGitignore
  Optional boolean.
  MVP default is false.
  MVP only accepts false.
```

`ignore.mode: "auto"` は、指定された source が存在する場合に読む。存在しない source は diagnostic にしない。

`ignore.mode: "none"` は ignore file を読まない。`ignore.sources` と `ignore.useGlobalGitignore` は指定できない。

`ignore.useGlobalGitignore: true` は MVP では validation error とする。理由は、global config の解決が環境依存になり、stdout result の再現性が下がるためである。

## 対象 source

### .gitignore

`request.root` 配下の directory を traversal するとき、各 directory の `.gitignore` を読む。

例:

```text
request.root
  .gitignore
  src/
    .gitignore
    generated/
```

`src/.gitignore` は `src/` 配下にだけ適用する。

### .ignore

`.ignore` は `.gitignore` と同じ階層適用ルールで扱う。

`request.root` 配下の directory にある `.ignore` を読む。

### .git/info/exclude

`.git/info/exclude` は `request.root/.git/info/exclude` が存在する場合だけ読む。

Git root auto detection はしない。たとえば `request.root` が `src` の場合、親 directory の `.git/info/exclude` は読まない。

## ignore pattern subset

MVP では Git ignore の全機能を実装対象にしない。実装対象 subset を明示する。

対応する pattern:

```text
blank line
  ignored

# comment
  ignored

foo
  current ignore file の directory 以下の basename "foo" に match

foo/
  directory basename "foo" に match

*.log
  basename glob

build/*.tmp
  current ignore file の directory からの relative path glob

/build
  current ignore file の directory 直下の "build" に match

docs/**/*.tmp
  current ignore file の directory 以下の path glob
```

対応しない pattern:

```text
!important.log
  negation / unignore

\#literal
  escaped leading hash

\!literal
  escaped leading exclamation

trailing space escape
  Git と同一の whitespace escape semantics

character class
  [abc] や [!abc]

brace expansion
  {a,b}
```

unsupported pattern はその ignore file 全体を無効にせず、該当 pattern だけ無視し、`unsupported_ignore_pattern` diagnostic を返す。

## 既存 exclude との関係

除外判定は OR とする。

file / directory は次のいずれかに該当すれば skip される。

- default exclude preset
- `excludeFileNamePatterns`
- `excludeDirNamePatterns`
- ignore file pattern
- root escape
- symlink
- traversal / resource limit

`excludeFileNamePatterns` / `excludeDirNamePatterns` が指定された場合の既存挙動は維持する。つまり、指定ありの場合は default exclude preset を置き換える。

ignore file は default exclude preset とは独立して適用する。`excludeFileNamePatterns: []` や `excludeDirNamePatterns: []` を指定しても、`ignore.mode: "auto"` であれば ignore file による除外は有効である。

すべての ignore file 除外も無効にしたい場合は `ignore.mode: "none"` を指定する。

## traversal / directory search との関係

directory が ignore file により除外された場合、その directory 自体は result に返さず、配下も traversal しない。

`search.targets` に `directory` が含まれていても、ignored directory は match result に返さない。

file が ignore file により除外された場合、`filepath` target にも `content` target にも使わない。

ignore file 自体は、ignore rule を読むために処理する。ただし検索対象としては通常 file と同じ扱いにする。たとえば query が `.gitignore` で `targets: ["filepath"]` の場合、`.gitignore` 自体が ignore rule で除外されていなければ match result に返してよい。

## summary

`summary` に ignore による skip 件数を追加する。

```json
{
  "summary": {
    "filesVisited": 140,
    "directoriesVisited": 20,
    "filesScanned": 120,
    "directoriesScanned": 18,
    "filesMatched": 3,
    "directoriesMatched": 2,
    "filesIgnored": 10,
    "directoriesIgnored": 2,
    "matches": 8,
    "diagnostics": 0,
    "truncated": false,
    "truncatedReason": null
  }
}
```

意味:

```text
filesIgnored
  ignore file pattern により skip された file 数

directoriesIgnored
  ignore file pattern により skip された directory 数
```

default exclude preset や explicit exclude pattern による skip は `filesIgnored` / `directoriesIgnored` には含めない。これらは ignore file 由来の skip 件数だけを表す。

## effectiveRequest

`effectiveRequest.ignore` は default 適用後の ignore 設定と、実際に読めた source を返す。

```json
{
  "effectiveRequest": {
    "ignore": {
      "mode": "auto",
      "sources": [".gitignore", ".ignore", ".git/info/exclude"],
      "useGlobalGitignore": false,
      "loadedSources": [
        {
          "path": ".gitignore",
          "baseDirectory": ".",
          "patterns": 4,
          "unsupportedPatterns": 1
        },
        {
          "path": "src/.gitignore",
          "baseDirectory": "src",
          "patterns": 2,
          "unsupportedPatterns": 0
        }
      ]
    }
  }
}
```

`loadedSources` は存在し、読めた ignore file だけを返す。

`mode: "none"` の場合:

```json
{
  "ignore": {
    "mode": "none",
    "sources": [],
    "useGlobalGitignore": false,
    "loadedSources": []
  }
}
```

## diagnostics

追加 code:

```text
invalid_ignore_mode
invalid_ignore_sources
invalid_ignore_source
invalid_ignore_global
ignore_file_not_readable
unsupported_ignore_pattern
```

validation error:

```text
invalid_ignore_mode
  ignore.mode が auto / none ではない

invalid_ignore_sources
  ignore.sources が string array ではない、または mode none と同時指定された

invalid_ignore_source
  ignore.sources[] が許可 source ではない

invalid_ignore_global
  ignore.useGlobalGitignore が boolean ではない、または true が指定された
```

runtime diagnostic:

```text
ignore_file_not_readable
  ignore source が存在するが読めない

unsupported_ignore_pattern
  MVP subset で扱えない pattern があった
```

`ignore_file_not_readable` は warning とし、検索は継続する。

`unsupported_ignore_pattern` は warning とし、該当 pattern だけ無視して検索は継続する。

diagnostic example:

```json
{
  "severity": "warning",
  "code": "unsupported_ignore_pattern",
  "message": "ignore pattern is not supported and was skipped",
  "path": "src/.gitignore",
  "line": 4,
  "skipped": true,
  "details": {
    "pattern": "!keep.generated.ts",
    "reason": "negation is outside MVP"
  }
}
```

## sort order

ignore file support は match sort order を変えない。

ignore file により候補から除外された path は sort 対象に入らない。

## validation error codes

追加 code:

```text
invalid_ignore_mode
invalid_ignore_sources
invalid_ignore_source
invalid_ignore_global
```

## security / reproducibility

ignore file は検索対象 repository 内の text file であり、信頼できない入力である。

MVP では ignore file の pattern subset を限定し、unsupported pattern は warning diagnostic として扱う。

global gitignore は環境依存であり、同じ request JSON でも caller の home directory や Git config により結果が変わる。このため MVP では扱わない。

`effectiveRequest.ignore.loadedSources` を返すことで、agent と automation はどの ignore file が結果に影響したかを確認できる。

## 実装決定

- `ignore` request object を追加する。
- `ignore.mode` は `auto` / `none` とする。
- `ignore.mode` default は `auto` とする。
- MVP source は `.gitignore`、`.ignore`、`.git/info/exclude` とする。
- global gitignore は MVP では未対応とし、`useGlobalGitignore: true` は validation error とする。
- `ignore.sources` は許可 source の選択だけに使い、任意 path は受け取らない。
- `summary.filesIgnored` / `summary.directoriesIgnored` を追加する。
- `effectiveRequest.ignore.loadedSources` を追加する。
- unsupported pattern は該当 pattern だけ skip し、warning diagnostic を返す。
- unreadable ignore file は warning diagnostic を返し、検索は継続する。

## 判断メモ

default を `auto` にする理由は、agent が通常期待する repository search が Git / ignore file の除外方針に近いためである。

一方で、完全な Git ignore 互換を MVP に含めると実装負荷と検証範囲が大きくなる。まずは AI agent が拾いすぎを避ける用途に効く subset から開始し、negation / escape / global gitignore は後続検討とする。

`ignore.mode: "none"` を用意することで、監査や低レベル調査では ignore file を無効化して全候補を検索できる。
