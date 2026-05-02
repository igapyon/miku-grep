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
  - 現状: TypeScript 実装では `src/main.ts` の自前 validation で開始。
  - TODO: 実装がさらに肥大化した場合は JSON Schema 等の導入を再検討する。

- [x] Node module shape
  - 決定: 開発ソースは必要に応じて分割してよい。
  - 決定: 配布 runtime artifact は単一 `.mjs` (`bundle/miku-grep.mjs`) とする。
  - 実装: package `bin` は `miku-grep`、開発時 entry は `dist/main.js`、配布 runtime artifact は `bundle/miku-grep.mjs`。

- [x] test runner
  - 決定: Vitest を候補として進める。
  - 実装: `package.json` の `test` script は `vitest run`。

- [x] Shift_JIS decoder
  - 決定: `iconv-lite` を使う。
  - 確認: npm の `iconv-lite` は MIT License。
  - 実装: `package.json` の dependency に `iconv-lite` を明記。

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

## implementation follow-up

- [x] README public path hygiene
  - 実装: README の CLI specification link を repository-relative path に修正。

- [x] package dry-run
  - 確認: `npm_config_cache=.npm-cache npm pack --dry-run` で package contents を確認。
  - 補足: default npm cache は local environment の権限問題で失敗したため、workspace-local cache を指定して確認した。

- [x] CLI subprocess tests
  - 実装: `dist/main.js` を subprocess として実行し、exit code / stdout JSON / stderr contract を確認。

- [x] limit behavior tests
  - 実装: `maxMatches` と `maxMatchesPerFile` 到達時の `summary` / `matches[]` / `diagnostics[]` をテストで固定。

- [x] diagnostic code inventory
  - validation / expected failure codes implemented:
    - `invalid_request`
    - `unknown_field`
    - `invalid_version`
    - `invalid_query_type`
    - `invalid_search_target`
    - `invalid_output_mode`
    - `invalid_regex`
    - `root_not_found`
    - `root_not_accessible`
    - `root_too_broad`
    - `empty_query`
    - `max_matches_too_large`
    - `max_matches_per_file_too_large`
    - `max_depth_too_large`
    - `max_line_length_too_large`
    - `max_snippets_per_file_too_large`
    - `max_file_bytes_too_large`
    - `invalid_encoding`
    - `invalid_encoding_rule`
  - runtime diagnostic codes implemented:
    - `directory_not_readable`
    - `symlink_skipped`
    - `file_not_readable`
    - `max_file_bytes_exceeded`
    - `binary_file_skipped`
    - `decode_error`
    - `max_matches`
    - `max_matches_per_file`
    - `max_snippets_per_file`

## later refactoring candidates

まとめてリファクタリングする段階で検討する。

### Refactoring guardrails

- [x] 外部CLI契約を変えない
  - `stdin` request JSON / `stdout` result JSON / `stderr` 方針 / exit code を維持する。
  - `--version` / `--help` の挙動を維持する。
  - `bundle/miku-grep.mjs` と `bundle/miku-grep-sources.tgz` の生成・smoke確認を維持する。
  - 確認: `npm test` / `npm run build` / `npm run smoke` / `npm run smoke:bundle` / `npm_config_cache=.npm-cache npm pack --dry-run` が成功。

- [x] リファクタリング単位ごとに `npm test` を通す
  - 機能変更ではなく責務分離が目的なので、既存テストを安全網として使う。
  - 最終確認は `npm run build` / `npm run smoke` / `npm run smoke:bundle` / `npm_config_cache=.npm-cache npm pack --dry-run`。
  - 確認: `help` / `glob` / `validation` / `result` / `search` 分離後に `npm test` が成功。

### Recommended refactoring order

- [x] 1. `helpText()` を `src/help.ts` に分離する
  - 理由: AI agent 向けの自己説明が長く、CLI制御や検索実装と責務が異なる。
  - 完了条件: `src/main.ts` は `helpText` を import して呼ぶだけにする。help文面と既存helpテストは変更しない。
  - 実装: `src/help.ts` に分離し、`src/main.ts` から re-export して既存 import contract を維持。

- [x] 2. glob / path matching を `src/glob.ts` または `src/path-utils.ts` に分離する
  - 理由: include / exclude、encoding pathPattern、filename pattern の責務を明確にする。
  - 完了条件: `globMatch` / path pattern matching / `matchesAny` を独立させ、検索・encoding selection から再利用する。
  - 実装: `src/glob.ts` に分離し、`src/main.ts` から `globMatch` を re-export して既存 import contract を維持。

- [x] 3. request validation を `src/validation.ts` に分離する
  - 理由: validation code と effectiveRequest default展開が増えている。
  - 完了条件: `validateAndNormalize`、validation helper、default値、limit値、default exclude preset を validation module 側に寄せる。`runRequest` は validation result を受け取るだけにする。
  - 実装: `src/validation.ts` に分離し、`VERSION` / default値 / limit値 / default exclude preset / validation helper を移動。

- [x] 4. diagnostics / summary helper を `src/result.ts` または `src/diagnostics.ts` に分離する
  - 理由: diagnostic sorting、truncation diagnostic重複抑制、summary更新を局所化する。
  - 完了条件: `createSummary` / `finish` / `sortDiagnostics` / truncation helper の責務をまとめ、検索処理が result formatting の詳細を持ちすぎない状態にする。
  - 実装: `src/result.ts` に `createSummary` / `finish` / diagnostic sorting を分離。truncation helper は検索状態に依存するため、`src/search.ts` 分離時に検索 module 側へ閉じ込める。

- [x] 5. traversal / file search を `src/search.ts` に分離する
  - 理由: directory traversal、filename search、content search、limit処理を独立して読みやすくする。
  - 完了条件: `runRequest` は root check、validation、search実行、finish の流れだけを表す。`SearchState` と検索内部 helper は search module に閉じる。
  - 実装: `src/search.ts` に `runSearch`、`SearchState`、traversal、content / filename search、limit / truncation helper を分離。

- [x] 6. tests を機能別に分割する
  - 候補: `cli-meta.test.ts`、`validation.test.ts`、`search-content.test.ts`、`search-filename.test.ts`、`encoding.test.ts`、`limits.test.ts`、`subprocess.test.ts`
  - 理由: `test/miku-grep-cli.test.ts` がMVP仕様全体を保持して大きくなっている。
  - 完了条件: test helper / fixture helper を共通化し、各テストファイルの関心を1つに絞る。
  - 実装: `test/helpers.ts` に fixture / stdio helper を共通化し、CLI meta、validation、content search、filename/both search、encoding/diagnostics、limits に分割。

### Deferred refactoring ideas

- [x] `src/types.ts` の公開型と内部型の境界を見直す
  - 現時点では実装分割後に判断する。先に型だけを動かすと差分が読みにくくなるため後回し。
  - 実装: 公開 JSON contract 型を `src/public-types.ts` に分離し、`src/types.ts` は互換用 re-export facade として維持。モジュール間だけで使う `ValidationResult` / `SearchResult` / `SearchState` は `src/internal-types.ts` に分離。

- [x] JSON Schema 導入を再検討する
  - 現時点では自前validationを維持する。分離後も validation が肥大化する場合のみ再検討する。
  - 判断: 現状は public schema が小さく、未知 field / default 展開 / diagnostic code を自前 validation で明示できているため、MVP では JSON Schema を導入しない。
