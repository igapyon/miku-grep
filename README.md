# miku-grep

`miku-grep` は、生成AI agent と automation が repository やディレクトリ内で「読むべきファイル」を見つけるための local-first 検索 CLI です。

通常の `grep` の代わりに、検索結果、summary、diagnostics を JSON として返します。人間が画面で読む検索結果ではなく、次の処理に渡しやすい structured result を得るための tool です。

厳格な CLI / JSON 仕様は [docs/miku-grep-cli-spec.md](docs/miku-grep-cli-spec.md) を参照してください。

セキュリティに関する調査結果と対策は [docs/miku-grep-security.md](docs/miku-grep-security.md) を参照してください。

## 何に使うか

`miku-grep` は、生成AI agent や script が local repository を読む前に、候補 file を絞り込むために使います。

主な用途:

- file content から読むべき file を探す
- file path / file name から候補を探す
- content と filename の両方を同じ request で探す
- result JSON の `summary` と `diagnostics` を見て、検索範囲や skipped file を判断する
- `file-summary` で候補 file を絞ってから、必要に応じて `detail` で snippet を読む

`miku-grep` は semantic search ではありません。embedding search、意味による ranking、Git repository root の自動検出は行いません。

## すぐ使う

stdin で request JSON を渡し、stdout から result JSON を受け取ります。

```bash
miku-grep < request.json > result.json
```

最小 request 例:

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "RepositoryMap"
  },
  "search": {
    "target": "content"
  }
}
```

`root` が相対 path の場合、CLI process の current working directory から解決されます。`miku-grep` は Git repository root を自動検出しないため、検索したい directory を `root` に指定してください。

`--version` と `--help` は stdin JSON なしで実行できます。

```bash
miku-grep --version
miku-grep --help
```

`--help` は、生成AI agent や automation が request JSON を組み立てるために必要な stdin / stdout contract、request field、default、result shape、diagnostics、例を stdout に出力します。

## よく使う request

### file content を検索する

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "diagnostics"
  },
  "search": {
    "target": "content"
  }
}
```

### filename を検索する

`filename` は basename だけでなく、`root` からの相対 file path を検索します。

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "security"
  },
  "search": {
    "target": "filename"
  }
}
```

### filename と content の両方を検索する

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "encoding"
  },
  "search": {
    "target": "both"
  }
}
```

### 対象 file を絞る

include / exclude は glob pattern です。`query.type: "regex"` は検索語の解釈だけを切り替えます。

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "effectiveRequest"
  },
  "search": {
    "target": "content",
    "includeFileNamePatterns": ["*.ts", "*.md"],
    "excludeDirNamePatterns": [".git", "node_modules", "dist"]
  }
}
```

`excludeFileNamePatterns` と `excludeDirNamePatterns` が未指定の場合は default exclude preset が使われます。`.git`、`node_modules`、`target`、`build`、`dist`、`vendor` など、通常の検索で読みたくない directory は既定で除外されます。

### detail 出力にする

`output` 未指定時は `file-summary` です。まず候補 file を絞る用途ではこれが既定です。

hit ごとの行、column、matched text が必要な場合は `detail` を指定します。

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "RepositoryMap"
  },
  "search": {
    "target": "content"
  },
  "output": {
    "mode": "detail",
    "maxMatches": 200,
    "maxMatchesPerFile": 20,
    "maxLineLength": 240
  }
}
```

### Shift_JIS file を検索する

encoding auto detect は行いません。UTF-8 以外を読む場合は encoding rule を指定します。

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "検索語"
  },
  "search": {
    "target": "content",
    "includeFileNamePatterns": ["*.txt"]
  },
  "encoding": {
    "default": "utf-8",
    "rules": [
      {
        "fileNamePattern": "*.txt",
        "encoding": "shift_jis"
      }
    ],
    "onDecodeError": "skip"
  }
}
```

読めなかった file、binary と判定された file、size limit を超えた file などは `diagnostics` に返されます。

### regex で検索する

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "regex",
    "text": "Repository(Map|Index)"
  },
  "search": {
    "target": "content"
  }
}
```

検索は case-sensitive です。`caseSensitive` や `ignoreCase` option はありません。case variation が必要な場合は regex pattern で表現してください。

## result の読み方

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

主な field:

- `ok`: request が実行できたかどうか
- `error`: `ok: false` のときの代表 error
- `effectiveRequest`: default 適用後の実際の検索条件
- `matches`: 検索結果。`output.mode` によって item shape が変わります
- `summary`: scanned file 数、hit 数、truncation の有無
- `diagnostics`: skipped file、decode error、limit 到達、validation error など

`file-summary` mode の `matches[]` は、1 matched file = 1 item です。agent が次に読む file を選ぶ最初の検索に向いています。

`detail` mode の `matches[]` は、1 hit = 1 item です。line、column、matched text、snippet を見たい場合に使います。

## 注意点

- stdout は result JSON 専用です。progress log や runtime-level message は stderr に出します。
- request JSON と result JSON はどちらも top-level に `version: 1` を持ちます。
- request JSON の未知 field は validation error です。
- result JSON 内の `file` は `root` からの相対 path です。絶対 path は返しません。
- path separator は platform に関わらず `/` です。
- symlink は MVP では追跡しません。
- content 検索では file size、line length、match count などの resource limit が適用されます。
- regex は Node.js `RegExp` を使いますが、JavaScript 固有の flags は request schema では受け取りません。

詳細な default、limit、schema、exit code、diagnostic code、sort order は [miku-grep CLI Specification](docs/miku-grep-cli-spec.md) を参照してください。

## 開発

依存関係を入れます。

```bash
npm install
```

テストを実行します。

```bash
npm test
```

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

## 関連ドキュメント

- [miku-grep CLI Specification](docs/miku-grep-cli-spec.md)
- [miku-grep Security Notes](docs/miku-grep-security.md)
- [Miku Software Overview Design](docs/miku-soft-00-overview-design-v20260427.md)
- [Miku Software Main Application Design](docs/miku-soft-10-mainapp-design-v20260501.md)
- [Miku Software Agent Skills Design](docs/miku-soft-40-agentskills-design-v20260501.md)

## 関連プロジェクト

- Agent Skills 版: [miku-grep-skills](https://github.com/igapyon/miku-grep-skills)
- Java 版: [miku-grep-java](https://github.com/igapyon/miku-grep-java)

## 後続候補

- Repository map 別プロダクト候補: [Repository Map Product Candidate](docs/product-candidate-repository-map.md)
- Policy-aware search 別プロダクト候補: [Policy-Aware Search Requirements Memo](docs/product-candidate-policy-aware-search.md)

MCP adapter は当面対応しません。まずは CLI、Java 版、Agent Skills 版を通常の利用経路として扱います。
