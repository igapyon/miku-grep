# TODO

## stdout result JSON schema

次の項目は stdout の result JSON schema として追加検討する。

- [x] `matches[]` の `detail` / `file-summary` schema
  - `output.mode: "detail"` の 1 hit = 1 row の item 形式を決める
  - `output.mode: "file-summary"` の 1 file = 1 row の item 形式を決める
  - 決定: `output.mode` によって `matches[]` item schema は変えてよい。ただし各 item は必ず `type` を持つ。

- [x] `diagnostics[]` の共通 schema
  - `severity`
  - `code`
  - `message`
  - `file` / `path` / `line` などの location
  - `skipped`
  - `encoding`
  - `encodingRule`
  - 決定: 必須 field は `severity` / `code` / `message`。任意 field は `file` / `path` / `line` / `skipped` / `encoding` / `encodingRule` / `details`。

- [x] `summary` の項目名と意味
  - `filesVisited`
  - `filesScanned`
  - `filesMatched`
  - `matches`
  - `diagnostics`
  - `truncated`
  - `truncatedReason`
  - 決定: `filesVisited` は traversal で見たファイル数、`filesScanned` は実際に検索処理したファイル数として分ける。`matches` は全 hit 数であり、`file-summary` では `matches[]` item 数と一致しない場合がある。

- [x] filename match と content match の表現
  - `search.target: "filename"` の match item 形式を決める
  - `search.target: "content"` の match item 形式を決める
  - `search.target: "both"` で filename hit と content hit を同じ `matches[]` に入れる場合の識別子を決める
  - 決定: `matchType` は作らず `type` を使う。`detail` では `type: "filename" | "content"`、`file-summary` では `type: "file"` と `matchTypes` / `filenameMatched` / `contentMatched` を使う。

## query / regex follow-up

- [x] case-sensitive / case-insensitive search の扱い
  - 決定: MVP は case-sensitive 固定。
  - 決定: `caseSensitive` / `ignoreCase` option は持たない。
  - 決定: case variation が必要な場合は `query.type: "regex"` の pattern で表現する。
  - 決定: JavaScript 固有の regex flags を public schema にしない。
  - Java CLI でも同じ意味にできる portable regex subset を前提にする。

## request / output defaults

- [x] content hit の位置情報
  - 決定: content hit には `column` と `matchedText` を返す。
  - 決定: `line` と `column` は 1-based。

- [x] snippet trim
  - 決定: `text` には source file 由来の文字だけを入れる。
  - 決定: 人工的な `...` は `text` に混ぜない。
  - 決定: snippet が元行の途中から始まる場合は `textStartColumn` を返す。

- [x] default output values
  - 決定: `output.mode` default は `file-summary`。
  - 決定: `maxMatches: 200`、`maxMatchesPerFile: 20`、`maxLineLength: 240`、`maxSnippetsPerFile: 3`。

- [x] unknown fields
  - 決定: request JSON の未知 field は `ok: false` validation error。

- [x] empty arrays
  - 決定: `includeFileNamePatterns` missing or `[]` は include 制限なし。
  - 決定: `excludeFileNamePatterns` missing or `[]` は default exclude preset のみ。
  - 決定: `excludeDirNamePatterns` missing or `[]` は default exclude preset のみ。

## implementation preflight decisions

- [x] request defaults
  - 決定: `search.recursive` missing は `true`。
  - 決定: `search.maxDepth` missing は `20`。
  - 決定: `encoding.default` missing は `utf-8`。
  - 決定: `encoding.rules` missing は `[]`。
  - 決定: `encoding.onDecodeError` missing は `skip`。

- [x] root and paths
  - 決定: relative `root` は CLI process の current working directory から解決する。
  - 決定: result `file` path separator は常に `/`。

- [x] glob MVP
  - 決定: MVP glob は `*` と `?` のみ。
  - 決定: glob は path separator をまたがない。

- [x] maxFileBytes
  - 決定: `search.maxFileBytes` default は 10 MiB (`10485760`)。
  - 決定: 超過ファイルは content search で skip し diagnostics に返す。

- [x] stdout formatting
  - 決定: stdout result JSON は 2-space indent で整形し、末尾 newline を付ける。

- [x] validation error codes
  - 決定: MVP の最小 validation error code 一覧を spec に固定する。

- [x] BOM
  - 決定: UTF-8 BOM は decode 後、検索前に除去する。

- [x] glob implementation
  - 決定: MVP glob は自前実装。
  - 理由: `*` / `?` の basename match のみなので、依存を増やさず実装できる。

- [x] validation implementation
  - 決定: MVP request validation は自前実装。
  - TODO: 実装が肥大化した場合は JSON Schema 等の導入を再検討する。

- [x] Node module shape
  - 決定: 開発ソースは必要に応じて分割してよい。
  - 決定: 配布 runtime artifact は単一 `.mjs` (`bundle/miku-grep.mjs`) とする。
  - TODO: package `bin` の正式なコマンド名と配置は実装時に決める。

- [x] test runner
  - 決定: Vitest を候補として進める。
  - TODO: 実装開始時に `package.json` と test script を確定する。

- [x] Shift_JIS decoder
  - 決定: `iconv-lite` を使う。
  - 確認: npm の `iconv-lite` は MIT License。
  - TODO: `package.json` に dependency として明記する。

- [x] numeric safety limits
  - 決定: `search.maxDepth` の最大許容値は `50`。
  - 決定: `output.maxMatches` の最大許容値は `10000`。
  - 決定: `output.maxMatchesPerFile` の最大許容値は `1000`。
  - 決定: `output.maxLineLength` の最大許容値は `4000`。
  - 決定: `search.maxFileBytes` の最大許容値は 100 MiB (`104857600`)。
  - 決定: `output.maxSnippetsPerFile` の最大許容値は `100`。

## mikuproject observations to adopt

- [x] runtime artifact version
  - 決定: bundled `.mjs` には build 時点の package version を埋め込む。
  - 決定: `--version` は stdin JSON なしで動作し、bundle smoke test に使う。

- [x] CLI bundle outputs
  - 決定: `bundle/miku-grep.mjs` を単一 Node.js CLI runtime artifact とする。
  - 決定: `bundle/miku-grep-sources.tgz` を再ビルド・監査・下流確認用 source archive とする。
  - 決定: release asset 名は `miku-grep-<version>.mjs` / `miku-grep-sources-<version>.tgz` を想定する。

- [x] stdio smoke example
  - 決定: `scripts/stdio-example.mjs` などで stdin request JSON / stdout result JSON の最小例を置く。

- [x] stderr discipline
  - 決定: verbose / progress / runtime-level messages は stderr。
  - 決定: stdout は result JSON 専用。ただし `--version` のような explicit meta command は例外。

- [x] exit 2 / exit 3 stdout policy
  - 決定: exit code `2` / `3` でも、result JSON を安全に構築できる場合は stdout に返す。
  - 決定: malformed stdin、CLI usage error、unexpected runtime error などで result JSON を安全に構築できない場合は stderr-only を許容する。
  - 決定: caller は exit code を authoritative に扱う。
