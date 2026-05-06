# TODO

## next specification candidates

- [x] AI agent 向け検索フロー強化を前向きに仕様検討・実装する
  - 優先度: 最優先候補。`miku-grep` を「検索して終わり」ではなく、「探す」「候補を絞る」「次に読む file を選ぶ」流れまで支える tool として強化する。
  - 前提: 現時点ではユーザー数が少ないため、下方互換性よりも agent が生成しやすい request JSON と読みやすい result JSON を優先してよい。
  - 方針: 仕様を過度に grep 互換へ寄せず、repository search / inventory / handoff helper として自然な schema に整理する。
  - 実装: case-insensitive search、listFiles、agent mode、readfile hints、detectGitRoot、glob query、encoding preset、relevance sort を追加した。
  - 確認: `npm test` が成功。
  - 関連: `docs/miku-grep-cli-spec.md`, `README.md`

- [x] case-insensitive 検索を仕様検討・実装する
  - 優先度: 最優先候補。AI agent が検索語の大文字小文字を外して取りこぼすことを減らす。
  - 目的: literal / regex / filepath / directory / content search の case sensitivity を request で指定できるようにする。
  - 実装: `query.case` を `"sensitive"` / `"insensitive"` とし、default は `"sensitive"` とする。
  - 実装: 互換性を重視しないため、`caseSensitive: false` より `query.case: "insensitive"` を採用した。
  - 実装: regex search では Node.js `RegExp` の `i` flag 相当を内部で使うが、public schema には JavaScript 固有 flag を出さない。
  - 実装: `matchedText` は source text 上の実際に match した文字列を返す。
  - 確認: `npm test` が成功。
  - 関連: `src/match-text.ts`, `src/validation.ts`, `docs/miku-grep-cli-spec.md`

- [x] ファイル一覧モードを仕様検討・実装する
  - 優先度: 最優先候補。`rg --files` 相当の repository inventory を JSON で返し、agent が最初の検索語や読む候補を決めやすくする。
  - 目的: `query` なしで file path 一覧、extension / directory / file count summary、diagnostics を返せる mode を追加する。
  - 実装: top-level `mode` を導入し、default は `"search"`、file listing は `"listFiles"` とする。
  - 実装: `mode: "search"` のときだけ `query` を必須にし、`mode: "listFiles"` では不要にする。
  - 実装: `.gitignore` / `.ignore` / `.git/info/exclude` と default exclude preset を検索時と同じ方針で反映する。
  - 実装: result path は従来どおり `root` 相対、`/` separator、absolute path 不返却を維持する。
  - 実装: `files[]` と `fileSummary` を listFiles 専用 result field として返す。`matches[]` は空配列にする。
  - 確認: `npm test` が成功。
  - 関連: `src/search.ts`, `src/result.ts`, `src/public-types.ts`, `docs/miku-grep-cli-spec.md`

- [x] agent 向け summary mode を仕様検討・実装する
  - 優先度: 高め。大量 match をそのまま返すのではなく、次に読む候補を選びやすい result shape を返す。
  - 目的: path、target kind、match count、representative snippets、推奨 read range を file / directory 単位でまとめる。
  - 実装: `output.mode: "agent"` を追加し、`summary` は機械的集計、`detail` は hit 詳細、`agent` は次に読む候補選定用と位置付ける。
  - 実装: `agent` mode は `miku-readfile` へ渡しやすい read range 候補も返す。
  - 実装: `matches[]` に `agentFile` / `agentDirectory` item を返す。
  - 確認: `npm test` が成功。
  - 関連: `src/search-results.ts`, `src/result.ts`, `docs/miku-grep-cli-spec.md`

- [x] miku-readfile request hint を仕様検討・実装する
  - 優先度: 高め。検索結果から `miku-readfile` request を組み立てやすくし、miku toolchain の agent workflow を自然につなげる。
  - 目的: matched file や agent summary candidate ごとに、次に読むための request hint を返せるようにする。
  - 実装: `output.includeReadfileRequestHints: true` を追加し、result に `readfileHints` を返す。
  - 実装: hint は `version`、`root`、`files[].path` を含む最小 request から始める。
  - 実装: file-bearing match item から生成し、directory-only match には hint を付けない。
  - 確認: `npm test` が成功。
  - 関連: `src/public-types.ts`, `src/result.ts`, `docs/miku-grep-cli-spec.md`

- [x] repo root 補助を仕様検討・実装する
  - 優先度: 中。agent が subdirectory から実行しても repository 全体を探索しやすくする。
  - 目的: `.git` を上位探索し、request root の誤指定による探索漏れを減らす。
  - 実装: top-level `detectGitRoot` を追加し、`true` の場合は `root` から上位の Git root を探索して effective root とする。
  - 実装: `effectiveRequest.requestedRoot` に指定 root、`effectiveRequest.root` に実際に使った root を返す。
  - 実装: default は `false` とし、探索範囲拡大は明示指定にする。
  - 確認: `npm test` が成功。
  - 関連: `src/main.ts`, `src/path-security.ts`, `docs/miku-grep-security.md`

- [x] glob 検索を仕様検討・実装する
  - 優先度: 中。検索語ではなく path glob で repository inventory を絞り込めるようにする。
  - 目的: `**/*.md`、`src/**/*.ts`、`**/README.md`、`**/package.json`、`**/pom.xml` のような path inventory query を扱う。
  - 実装: `query.type: "glob"` を追加し、`search.targets: ["filepath"]` / `["directory"]` や `mode: "listFiles"` と組み合わせる。
  - 実装: 既存の basename glob とは別に、`**` を含む path glob を仕様化する。
  - 実装: glob query は content search では validation error とし、filepath / directory target と listFiles filtering に適用する。
  - 確認: `npm test` が成功。
  - 関連: `src/glob.ts`, `src/validation.ts`, `docs/miku-grep-cli-spec.md`

- [x] encoding preset を仕様検討・実装する
  - 優先度: 中。Shift_JIS など日本語 legacy file を agent が指定しやすくする。
  - 目的: よくある日本語 legacy file pattern を preset としてまとめ、明示 rule より低い優先度で適用する。
  - 実装: `encoding.preset: "japanese-legacy"` を追加する。
  - 実装: 明示 `encoding.rules` は preset より優先し、result / diagnostics に実際に使った encoding と rule source を返す。
  - 実装: preset が扱う file pattern は仕様に固定し、環境依存の auto detect とは分ける。
  - 確認: `npm test` が成功。
  - 関連: `src/encoding.ts`, `src/public-types.ts`, `docs/miku-grep-cli-spec.md`

- [x] 簡易 ranking を仕様検討・実装する
  - 優先度: 中から低。semantic ranking ではなく、agent が読みやすい順に候補を並べる deterministic heuristic として扱う。
  - 目的: `README` / docs / src / test など用途別の優先、filepath match、match count、generated / vendor らしさ、diagnostics 有無を加味して候補順を調整する。
  - 実装: `output.sort: "path"` / `"relevance"` を追加し、`path` は deterministic path order、`relevance` は heuristic order とする。
  - 実装: default は再現性を優先して `"path"` とし、`detail` mode は既存の path / line order を維持する。
  - 実装: `relevance` の score または reason を result item に返し、agent が順序の根拠を確認できるようにする。
  - 実装: `summary` / `agent` mode の item に `relevance.score` と `relevance.reasons` を返す。
  - 確認: `npm test` が成功。
  - 関連: `src/search-results.ts`, `src/string-order.ts`, `docs/miku-grep-cli-spec.md`

- [x] filepath / directory detail mode の同一 path 複数 hit を代表 hit に集約する
  - 優先度: 高め。`query.type: "regex", text: ".*"` で path 一覧を取ると、末尾 zero-length match により同じ path が複数 item になりやすい。
  - 目的: `filepath` / `directory` target の `detail` mode では、同一 file path / directory path を最大 1 item として返す。
  - 実装: `content` target の `detail` mode は従来どおり 1 content hit = 1 item を維持。
  - 実装: path target の代表 `matchedText` は、最初の non-empty match を優先し、なければ最初の zero-length match を使う。
  - 実装: path target の `summary.matches` / summary item `matchCount` も代表 hit 1 件として数える。
  - 実装: `detail returns one item per hit` という README / CLI spec の説明を、content hit と path hit の違いが分かる表現へ更新。
  - 実装: `findMatches()` は content 用の全 hit 列挙として維持し、path target 側だけ representative hit を選ぶ helper を追加。
  - 確認: `npm test` が成功。
  - 関連: `docs/miku-grep-cli-spec.md`, `docs/miku-grep-search-targets-spec.md`

- [x] ignore file の negation / unignore pattern 対応を仕様検討・実装する
  - 優先度: 高め。`.gitignore` を尊重すると説明する以上、`!pattern` は利用者の期待に入りやすい。
  - 目的: `!keep.tmp` のような negation / unignore pattern を warning ではなく有効な ignore rule として扱う。
  - 実装: ignore rule を単純な OR 除外ではなく、source / directory / 行順を維持した順序評価にする。
  - 実装: 既存 subset の glob に対する negation を対象にし、Git ignore 完全互換とは分けて説明する。
  - 実装: ignored directory 配下の file を unignore するには、親 directory 自体も unignore する必要があると仕様化する。
  - 確認: `npm test` が成功。
  - 関連: `docs/miku-grep-ignore-files-spec.md`

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

- [x] case-sensitive / case-insensitive search の扱いを見直す
  - 旧決定: MVP は case-sensitive 固定、`caseSensitive` / `ignoreCase` option は持たない、case variation は regex pattern で表現する。
  - 見直し理由: AI agent が検索語の大文字小文字を外して取りこぼすことを減らす価値が高く、現時点では下方互換性より agent usability を優先してよい。
  - 実装: `query.case: "sensitive" | "insensitive"` を導入した。
  - 実装: JavaScript 固有の regex flags を直接 public schema にせず、将来 Java CLI でも意味がずれにくい portable behavior として仕様化する。

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

- AI向け heading 付き Markdown summary
  - 方針: 実施なし。
  - 理由: `miku-grep` runtime の primary output は stdout JSON に固定する。
  - 補足: Markdown summary が必要な場合は、まず Agent Skills / wrapper 側の derived formatter として扱う。
  - 注意: runtime contract を Markdown に寄せすぎると、structured grep としての安定性が下がる可能性がある。

- structural context
  - 方針: 実施なし。別プロダクト候補として扱う。
  - 理由: match が属する Markdown heading、class / function、JSON / YAML path、XML / HTML element path などは構造解析寄りで、`miku-grep` 本体の grep 代替機能からは外れる。
  - 検討候補: Markdown heading path、JS / TS / Java の class / function、JSON / YAML path、XML / HTML element path。

- npm publish
  - 方針: 実施なし。当面の配布は GitHub Release のみとし、npm publish は対象外とする。
  - 理由: package name / ownership、npm provenance、2FA、publish access、npm install 手順、release workflow まで含めると、現時点の local-first CLI 配布方針より運用負荷が大きい。

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
