# TODO

## next specification candidates

- [x] ディレクトリ検索機能を仕様検討・実装する
  - 目的: `find` 代替として、file だけでなく directory entry も検索・返せるようにする。
  - 実装: `search.targets` 配列で `filepath` / `directory` / `content` を組み合わせられるようにした。
  - 実装: `targets: ["filepath", "directory"]` を `find` 代替として扱う。
  - 実装: directory match は `type: "directory"` と `path` を返す。
  - 実装: `output.mode` は `summary` / `detail` とし、`summary` は file / directory の両方を返せる。
  - 実装: `summary` に `directoriesVisited` / `directoriesScanned` / `directoriesMatched` を追加。
  - 確認: `npm test` が成功。
  - 仕様: `docs/miku-grep-search-targets-spec.md`

- [x] `.gitignore` / ignore file 尊重を仕様検討・実装する
  - 優先度: 最優先候補。
  - 目的: `.gitignore` などで無視される file / directory を検索対象から除外できるようにする。
  - 実装: `ignore` request object を追加。
  - 実装: `ignore.mode` は `auto` / `none` とし、default は `auto`。
  - 実装: MVP source は `.gitignore`、`.ignore`、`.git/info/exclude`。
  - 実装: global gitignore は MVP では扱わず、`useGlobalGitignore: true` は validation error。
  - 実装: `ignore.sources` は許可 source の選択だけに使い、任意 path は受け取らない。
  - 実装: ignore file による除外は既存 exclude と OR で適用。
  - 実装: `summary.filesIgnored` / `summary.directoriesIgnored` を追加。
  - 実装: `effectiveRequest.ignore.loadedSources` で実際に読めた source を返す。
  - 実装: unreadable ignore file は `ignore_file_not_readable` warning diagnostic。
  - 実装: unsupported pattern は該当 pattern だけ skip し、`unsupported_ignore_pattern` warning diagnostic。
  - 確認: `npm test` が成功。
  - 仕様: `docs/miku-grep-ignore-files-spec.md`

- [x] match 前後 context lines を仕様検討する
  - 優先度: 高め。`miku-grep` 本体の検索結果品質を上げる機能として対応したい。
  - 目的: match 行だけでなく前後の text を返し、AI agent が検索結果だけで周辺文脈を判断しやすくする。
  - 実装: `output.mode: "detail"` 限定で追加。
  - 実装: `type: "content"` hit にだけ `contextBefore` / `contextAfter` を付ける。
  - 実装: `output.mode: "summary"` で context option が指定された場合は validation error。
  - 実装: `detail` mode で `search.targets` に `content` がなくても context option 指定は validation error にしない。
  - 実装: request field は `output.contextLines`、または `output.contextLinesBefore` / `output.contextLinesAfter`。
  - 実装: `contextLines` と before / after 個別指定の同時指定は validation error。
  - 実装: default は `0`、最大値は `20`。
  - 実装: validation code は `invalid_context_lines` / `context_lines_too_large`。
  - 実装: context 行にも `output.maxLineLength` を適用する。
  - 実装: context 行は `summary.matches` / `output.maxMatches` / `output.maxMatchesPerFile` に数えない。
  - 実装: context option 未指定時は context field を返さず、指定時は空配列も返す。
  - 仕様: `docs/miku-grep-context-lines-spec.md`

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
  - 決定: `excludeFileNamePatterns` missing は default exclude preset、指定ありは default exclude preset の置き換え、`[]` は file name 除外なし。
  - 決定: `excludeDirNamePatterns` missing は default exclude preset、指定ありは default exclude preset の置き換え、`[]` は directory name 除外なし。

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
    - `regex_too_large`
    - `unsafe_regex`
    - `root_not_found`
    - `root_not_accessible`
    - `root_too_broad`
    - `empty_query`
    - `max_matches_too_large`
    - `max_matches_per_file_too_large`
    - `max_depth_too_large`
    - `max_line_chars_too_large`
    - `max_files_visited_too_large`
    - `max_directories_visited_too_large`
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
    - `max_line_chars_exceeded`
    - `path_escape_skipped`
    - `max_matches`
    - `max_matches_per_file`
    - `max_snippets_per_file`
    - `max_files_visited`
    - `max_directories_visited`

## security follow-up

- [x] Regex ReDoS 対策を検討・実装する
  - 現状: `query.type: "regex"` は Node.js `RegExp` を直接使う。
  - リスク: catastrophic backtracking により CPU を長時間消費する可能性がある。
  - 実装: regex pattern length 上限と nested quantified group の最小 heuristic reject を追加。
  - 残課題: 完全な ReDoS 対策ではないため、RE2 系 engine または worker thread timeout は必要になった段階で再検討する。

- [x] traversal / file count DoS 対策を追加する
  - 現状: `maxDepth`、`maxFileBytes`、match limit はあるが、訪問ファイル数・訪問ディレクトリ数の上限はない。
  - 実装: `search.maxFilesVisited`、`search.maxDirectoriesVisited` を追加し、limit 到達時に `max_files_visited` / `max_directories_visited` diagnostic を返す。

- [x] TOCTOU リスクを整理する
  - 現状: `fs.realpath()` で root 境界を確認してから `fs.readFile()` する。
  - リスク: 確認後から read 前までに file が差し替えられる可能性がある。
  - 実装: local-first CLI としての残リスクを security docs に明記。file descriptor ベースの実装は必要になった段階で再検討する。

- [x] filename / diagnostics による情報漏えいを整理する
  - filename search は content を読まなくても file / path 名を返す。
  - diagnostics は unreadable path、decode error、path escape など repository 構造を返す。
  - 実装: security docs に agent 向け利便性と権限境界としての扱いを明記。

- [x] long line / binary-like text の resource risk を検討する
  - `maxLineLength` は output snippet 制限であり、入力 line 処理そのものの上限ではない。
  - NUL を含まない binary-like file は decode / line split 対象になり得る。
  - 実装: `search.maxLineChars` を追加し、超過行は `max_line_chars_exceeded` diagnostic として skip。
  - 残課題: NUL を含まない binary-like file の byte heuristic や追加 default exclude は必要になった段階で再検討する。

- [x] downstream injection / prompt injection を docs に追記する
  - `miku-grep` は JSON として escape して返すが、caller が shell / HTML / SQL / Markdown / prompt に再埋め込みする場合は別途 escape が必要。
  - 実装: 検索結果本文は信頼できない入力であり、agent が命令として扱わないことを security docs に明記。

- [x] security 実装と CLI spec の同期を取る
  - 実装: `request.root` realpath 境界チェック、`path_escape_skipped`、traversal limit、security diagnostic の扱いを `docs/miku-grep-cli-spec.md` に反映。

## not planned / parking lot

一通りの実装TODOは完了。以下は当面実施しない保留項目であり、必要になった段階で再検討する。

- [ ] AI向け heading 付き Markdown summary
  - 理由: `miku-grep` runtime の primary output は stdout JSON に固定する。
  - 方針: Markdown summary が必要な場合は、まず Agent Skills / wrapper 側の derived formatter として扱う。
  - 注意: runtime contract を Markdown に寄せすぎると、structured grep としての安定性が下がる可能性がある。

- [ ] structural context
  - 理由: match が属する Markdown heading、class / function、JSON / YAML path、XML / HTML element path などは構造解析寄りで、`miku-grep` 本体の grep 代替機能からは外れる。
  - 方針: 別プロダクト候補として扱う。
  - 検討候補: Markdown heading path、JS / TS / Java の class / function、JSON / YAML path、XML / HTML element path。

- [ ] npm publish
  - 方針: 当面の配布は GitHub Release のみとし、npm publish は遠い未来の検討事項とする。
  - 実施時の確認候補: package name / ownership、npm provenance、2FA、publish access、README の npm install 手順、release workflow。

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
