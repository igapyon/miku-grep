# miku-grep

`miku-grep` は、生成AI agent と automation が repository やディレクトリ内で「読むべきファイル」を見つけるための local-first 検索 CLI です。

通常の `grep` の代わりに、検索結果、summary、diagnostics を JSON として返します。

厳格な CLI / JSON 仕様は [docs/miku-grep-cli-spec.md](docs/miku-grep-cli-spec.md) を参照してください。

セキュリティに関する調査結果と対策は [docs/miku-grep-security.md](docs/miku-grep-security.md) を参照してください。

## 背景

生成AI agent と repository を扱っていると、通常の grep だけでは足りない場面があります。

特に重要なのは「何を読むべきか」を見つけることです。単なる文字列検索だけでなく、ディレクトリ構造、除外ルール、encoding、検索結果の形式、diagnostics を考慮した検索 tool が必要です。

まずは MCP ではなく CLI として作ります。将来的に Agent Skills から呼び出せる形にします。

## 対象

`miku-grep` の対象は grep 代替の repository / directory 検索 CLI です。

意味あり retrieve tool は対象外です。embedding search、semantic ranking、Git repository root の自動検出は行いません。

## MVP

現在の Node CLI MVP 実装では次を扱います。

- Node CLI
- stdin JSON 入力
- stdout JSON 出力
- `content` / `filename` / `both`
- `literal` / `regex`
- glob-based include / exclude
- default exclude preset
- recursive / maxDepth default
- `utf-8` / `shift_jis`
- encoding rules
- diagnostics
- `detail` / `file-summary`
- `--version`
- `--help`

`--help` は生成AI agent がそれだけを読んで request JSON を組み立てられるよう、stdin / stdout contract、request field、default、limit、result shape、diagnostic code、完全な stdin / stdout 例を含めています。

## CLI の基本形

stdin で request JSON を受け取り、stdout に result JSON を返します。

```bash
miku-grep < request.json > result.json
```

stderr は progress、verbose log、予期しない runtime-level message など、JSON result と混ぜたくない補助情報だけに使います。

request JSON と result JSON はどちらも top-level に `version: 1` を持ちます。

request JSON の未知 field は validation error とします。

stdout の result JSON は 2-space indent で整形して出力します。

runtime artifact の smoke test 用に、`--version` は stdin JSON なしで実行できます。

```bash
miku-grep --version
```

生成AI agent や automation がコマンド仕様を把握するために、`--help` も stdin JSON なしで実行できます。

```bash
miku-grep --help
```

`--help` は stdin / stdout contract、request field、default、limit、result shape、diagnostic code、完全な stdin / stdout 例、実行例を stdout に出力します。

## 最小 request 例

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
    "maxDepth": 8
  }
}
```

## result の基本形

stdout の result JSON は、成功時も期待可能な失敗時も同じ top-level shape を保ちます。

```json
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
```

`output` 未指定時の default は `file-summary` です。

```json
{
  "mode": "file-summary",
  "maxMatches": 200,
  "maxMatchesPerFile": 20,
  "maxLineLength": 240,
  "maxSnippetsPerFile": 3
}
```

output limit の最大許容値は `maxMatches: 10000`、`maxMatchesPerFile: 1000`、`maxLineLength: 4000`、`maxSnippetsPerFile: 100` です。

## 検索モード

```text
content
  ファイル内容を検索する

filename
  request.root からの相対 file path を検索する

both
  filename と content の両方を検索する
```

`miku-grep` は Git repository root を自動検出しません。`request.root` を検索エントリポイントとして扱い、その範囲だけを検索します。

`request.root` が相対パスの場合、CLI process の current working directory から解決します。

探索中に realpath が `request.root` の realpath 外へ解決される path は skip して diagnostics に返します。

result JSON 内の `file` は `request.root` からの相対パスです。絶対パスは返しません。path separator は platform に関わらず常に `/` です。

`recursive: true` で `maxDepth` を省略した場合、MVP では `20` として扱います。

`maxDepth` の最大許容値は `50` です。

`recursive` 未指定時は `true` です。

traversal の resource limit として、`search.maxFilesVisited` の default は `100000`、最大許容値は `1000000` です。`search.maxDirectoriesVisited` の default は `10000`、最大許容値は `100000` です。

## 除外の基本方針

include / exclude は glob pattern です。`query.type: "regex"` は検索語の解釈だけを切り替えます。

MVP では `search.excludeFileNamePatterns` と `search.excludeDirNamePatterns` が未指定の場合に default exclude preset を適用します。`.git`、`.svn`、`node_modules`、`target`、`build`、`dist`、`.gradle`、`.idea`、`.vscode`、`.settings`、`vendor` などを既定で除外します。

`search.excludeFileNamePatterns` または `search.excludeDirNamePatterns` を指定した場合、その配列は対応する default exclude preset を置き換えます。空配列 `[]` は、その種別の除外なしを意味します。

## encoding 方針

MVP では encoding auto detect / best-effort decode は行いません。

```text
推測しない
黙って失敗しない
適用した encoding rule を返す
読めなかったファイルを diagnostics に返す
```

対応 encoding はまず `utf-8` と `shift_jis` です。

`encoding.default` 未指定時は `utf-8`、`encoding.rules` 未指定時は `[]`、`encoding.onDecodeError` 未指定時は `skip` です。UTF-8 BOM は検索前に除去します。

content 検索では `search.maxFileBytes` の default を 10 MiB とし、超過ファイルは skip して diagnostics に返します。

`search.maxFileBytes` の最大許容値は 100 MiB です。

decode 後の 1 行が `search.maxLineChars` を超える場合、その行は skip して diagnostics に返します。default は `1000000`、最大許容値は `10000000` です。

## regex と case

MVP の検索は case-sensitive です。

`query.type: "literal"` は単純な substring search です。Unicode 正規化、locale 比較、case folding は行いません。

`caseSensitive` や `ignoreCase` の option は持ちません。case variation が必要な場合は `query.type: "regex"` の pattern で表現します。

MVP Node CLI の regex は Node.js `RegExp` を使い、content 検索では行ごとに match します。複数行 regex は MVP 外です。

JavaScript 固有の regex flags は MVP では受け取りません。将来の Java CLI では regex engine が異なる可能性があるため、cross-runtime の完全同一挙動は保証しません。

regex pattern text は 1000 文字以下に制限します。`(.+)+` や `(a*)+` のような nested quantified group は ReDoS リスクを避けるため validation error とします。

## 詳細仕様

詳細は [miku-grep CLI Specification](docs/miku-grep-cli-spec.md) にあります。

主な内容:

- stdin request JSON schema
- stdout result JSON schema
- exit code
- `effectiveRequest`
- `matches[]`
- `diagnostics[]`
- `summary`
- default exclude preset
- encoding policy
- dangerous request handling

## 開発

依存関係を入れます。

```bash
npm install
```

テストを実行します。

```bash
npm test
```

`npm test` は TypeScript compile 後に Vitest を実行します。現状のテストは CLI contract、request validation、検索モード、encoding、diagnostics、sort、limit、bundle前提の subprocess実行をカバーしています。

TypeScript compile、テスト、単一ファイル CLI bundle 生成をまとめて実行します。

```bash
npm run build
```

開発用 CLI の stdin / stdout smoke example を実行します。

```bash
npm run smoke
```

bundle 生成後に、単一ファイル runtime artifact の smoke test を実行します。

```bash
npm run smoke:bundle
```

主な生成物:

- `dist/main.js`
- `bundle/miku-grep.mjs`
- `bundle/miku-grep-sources.tgz`

`dist/main.js` は package `bin` が指す開発・npm package 用 CLI entry です。

`bundle/miku-grep.mjs` は source tree なしで実行できる単一ファイル runtime artifact です。

`bundle/miku-grep-sources.tgz` は再ビルド、監査、下流確認用の source archive です。

npm package には、CLI実行用の `dist/`、単一ファイル runtime artifact の `bundle/`、smoke / bundle生成用の `scripts/`、`README.md`、`LICENSE` を含めます。

## 後続

- Java CLI
- Agent Skills から呼べる説明
- Node.js single-file runtime artifact
- repository map 対応
- policy-aware search の強化

## MCP について

MCP は MVP では不要です。

まず CLI と Agent Skills まででよいです。MCP は tool interface の話なので、検索器の仕様が固まってから考えます。
