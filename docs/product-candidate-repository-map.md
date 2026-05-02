# Repository Map Product Candidate

## 目的

この文書は、repository / directory の構造を生成AI agent や automation が把握しやすい structured map として出力する別プロダクト候補を整理する。

この候補は `miku-grep` の検索機能そのものではない。`miku-grep` が query に対する match を返す tool であるのに対し、repository map tool は query なしで repository の入口、構造、主要 file 候補、除外理由、summary を返す。

## 仮称

候補名:

- `miku-repomap`
- `miku-repo-map`
- `miku-indexgen` 系の派生または後継

この文書では仮に `repository map tool` と呼ぶ。

## 背景

生成AI agent が repository を扱うとき、最初に必要なのは全文検索ではなく、どこに何があるかを把握するための軽量な repository overview である。

通常の `tree`、`find`、`ls` は人間向けの表示には便利だが、agent や script が次の判断に使うには次の点が不足する。

- machine-readable な summary がない
- default exclude や skip reason が構造化されない
- file 数、directory 数、拡張子分布、entrypoint 候補がまとまらない
- 生成物、依存 directory、巨大 file、binary file をどう扱ったかが見えにくい
- 後続の検索や読解で使う候補 file を選びにくい

repository map tool は、local repository を読む前の初期把握を支援する。

## 対象

対象は local repository / directory の構造 inventory である。

扱うもの:

- directory tree summary
- file inventory
- extension / directory summary
- entrypoint file candidates
- docs / config / build file candidates
- include / exclude 適用後の visible file set
- skipped path diagnostics
- resource limit diagnostics

扱わないもの:

- semantic search
- embedding search
- content ranking by meaning
- source code dependency graph の完全解析
- language server 相当の symbol index
- Git repository root の自動推論を前提にした探索
- project build の実行
- package install

## `miku-grep` との境界

`miku-grep`:

- query を受け取る
- content / filename / both を検索する
- match、summary、diagnostics を返す
- grep 代替の structured search CLI

repository map tool:

- query を必須にしない
- repository / directory の構造を要約する
- 次に読む file 候補を構造情報から提示する
- 検索 hit ではなく map / inventory / summary を返す

連携例:

1. repository map tool で repository overview を取得する
2. entrypoint candidates や docs candidates を agent が読む
3. `miku-grep` で特定語や API 名を検索する
4. 必要なら repository map tool の include / exclude policy を調整して再取得する

## CLI の基本形

stdin で request JSON を受け取り、stdout に result JSON を返す。

```bash
miku-repomap < request.json > result.json
```

`--version` と `--help` は stdin JSON なしで実行できる。

```bash
miku-repomap --version
miku-repomap --help
```

stdout は result JSON 専用とし、progress log や runtime-level message は stderr に出す。

## request JSON 案

```json
{
  "version": 1,
  "root": ".",
  "map": {
    "maxDepth": 6,
    "includeFiles": true,
    "includeDirectories": true,
    "includeSummaries": true,
    "includeEntrypointCandidates": true
  },
  "search": {
    "includeFileNamePatterns": [],
    "excludeFileNamePatterns": null,
    "excludeDirNamePatterns": null,
    "maxFilesVisited": 100000,
    "maxDirectoriesVisited": 10000
  },
  "output": {
    "mode": "summary",
    "maxTreeEntries": 1000,
    "maxFileEntries": 2000
  }
}
```

### root

`root` は map 作成の entry point である。

`root` が相対 path の場合、CLI process の current working directory から解決する。

result JSON 内の file / directory path は `root` からの相対 path とし、絶対 path は返さない。

path separator は platform に関わらず `/` とする。

### map

`map.maxDepth` は tree / traversal の深さを制限する。

`includeFiles` は file entry を result に含めるかを指定する。

`includeDirectories` は directory entry を result に含めるかを指定する。

`includeSummaries` は extension summary、directory summary、size summary などを含めるかを指定する。

`includeEntrypointCandidates` は agent が最初に読む候補 file を抽出するかを指定する。

### search

`search` は traversal 対象を絞るための include / exclude と resource limit を持つ。

`miku-grep` と同様に、default exclude preset を持つのが自然である。

default exclude dir names の候補:

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

default exclude file name patterns の候補:

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

### output

`output.mode` の候補:

```text
summary
  agent が最初に読むための compact overview

tree
  directory tree を中心に返す

inventory
  file inventory を中心に返す

detail
  tree、inventory、summary、diagnostics を広く返す
```

MVP の default は `summary` が自然である。

## result JSON 案

```json
{
  "version": 1,
  "ok": true,
  "error": null,
  "effectiveRequest": {},
  "root": {
    "path": ".",
    "name": "example-repo"
  },
  "summary": {
    "directoriesVisited": 12,
    "filesVisited": 80,
    "filesIncluded": 64,
    "filesSkipped": 16,
    "extensions": [
      {
        "extension": ".ts",
        "files": 24
      },
      {
        "extension": ".md",
        "files": 6
      }
    ],
    "topDirectories": [
      {
        "directory": "src",
        "files": 30
      },
      {
        "directory": "docs",
        "files": 8
      }
    ],
    "diagnostics": 0,
    "truncated": false,
    "truncatedReason": null
  },
  "entrypointCandidates": [
    {
      "type": "readme",
      "file": "README.md",
      "reason": "repository readme"
    },
    {
      "type": "package",
      "file": "package.json",
      "reason": "node package metadata"
    },
    {
      "type": "spec",
      "file": "docs/miku-grep-cli-spec.md",
      "reason": "specification document"
    }
  ],
  "tree": [
    {
      "type": "directory",
      "path": "src",
      "depth": 1
    },
    {
      "type": "file",
      "path": "src/main.ts",
      "depth": 2,
      "extension": ".ts"
    }
  ],
  "files": [
    {
      "path": "README.md",
      "extension": ".md",
      "sizeBytes": 12000
    }
  ],
  "diagnostics": []
}
```

## entrypoint candidates

entrypoint candidates は、agent が最初に読む候補 file の一覧である。

候補 type の例:

```text
readme
  README.md など

license
  LICENSE など

package
  package.json、pom.xml、build.gradle など

config
  tsconfig.json、vite.config.ts、eslint config など

spec
  docs/*spec*.md、docs/*design*.md など

test
  representative test file

source_entry
  src/main.*、src/index.*、cli entry file など
```

MVP では content を読まず、file name / path pattern による候補抽出に限定するのがよい。

## diagnostics

diagnostics は skipped path や resource limit を構造化して返す。

例:

```json
{
  "severity": "info",
  "code": "directory_excluded",
  "message": "directory was excluded by default exclude preset",
  "path": "node_modules",
  "skipped": true
}
```

主な diagnostic code 候補:

```text
directory_excluded
file_excluded
symlink_skipped
path_escape_skipped
directory_not_readable
file_not_readable
max_depth_reached
max_files_visited
max_directories_visited
max_tree_entries
max_file_entries
root_not_found
root_not_accessible
root_too_broad
```

## security / safety 方針

`miku-grep` と同様に、local-first CLI として次を守る。

- stdout は JSON result 専用にする
- request JSON の未知 field は validation error にする
- `root` の realpath を検索境界として扱う
- root 外へ解決される path は skip して diagnostics に返す
- symlink は MVP では追跡しない
- default exclude preset を持つ
- 広すぎる root は拒否する
- result JSON に絶対 path を返さない

## MVP

MVP で扱うもの:

- Node CLI
- stdin JSON input
- stdout JSON output
- `--version`
- `--help`
- root-relative tree
- file inventory
- default exclude preset
- max depth
- traversal resource limit
- entrypoint candidates
- extension summary
- top directory summary
- diagnostics

MVP で扱わないもの:

- file content の読み取り
- semantic ranking
- language-specific parser
- dependency graph
- Git history
- Git ignore の完全解釈
- MCP
- Java CLI

## 今後の検討

- `miku-grep` と default exclude preset / diagnostics schema を揃える
- `miku-grep` request の前段として使いやすい result shape にする
- file content を読まない MVP と、必要最小限の metadata を読む将来版を分ける
- `summary` mode の compact さを agent token budget に合わせて調整する
- repository map result から `miku-grep` request を作りやすい field を追加する
