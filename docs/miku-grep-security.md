# miku-grep Security Notes v20260502

## 目的

この文書は、`miku-grep` のセキュリティに関する調査結果、現時点の対策、残っているリスク、今後の検討事項を記録する。

`miku-grep` は local-first な検索 CLI であり、主な入力は stdin の request JSON、主な出力は stdout の result JSON である。生成AI agent や automation から呼び出される前提があるため、通常の CLI よりも「入力が機械生成される」「検索 root が外部から指定される」「結果 JSON を後続処理が機械的に読む」点を重視する。

## セキュリティ方針

- stdout は JSON result 専用にする。
- 期待可能な失敗は result JSON の `ok: false` と diagnostics で返す。
- 予期しない runtime-level message は stderr に出す。
- request JSON の未知 field は validation error にする。
- 推測で危険な読み取りを続行しない。
- root、realpath、symlink、encoding、file size、match limit を明示的に扱う。

## JSON injection

### 調査結果

現実装では、result JSON は object を構築したうえで `JSON.stringify(result, null, 2)` により出力している。

検索対象ファイルの内容、ファイル名、diagnostic message、matched text は JSON 文字列値として escape されるため、検索対象に `"`、改行、`}`、`,` などが含まれていても JSON 構造を壊す形の injection は起きにくい。

### 現在の対策

- stdout result は `JSON.stringify` で生成する。
- 手作業の string concatenation で JSON を組み立てない。
- stdout に progress log や human-readable log を混ぜない。
- request の未知 field は拒否し、typo や意図しない入力を黙って無視しない。

### 残リスク

後続の caller が result JSON 内の文字列を別の文脈、たとえば shell command、HTML、SQL、Markdown、別の JSON template に未 escape で埋め込む場合、その後続文脈で injection が発生し得る。

`miku-grep` 側では JSON として正しく escape して返すことが責務であり、後続文脈への再埋め込み時は caller 側で文脈別 escape が必要である。

## Regex injection / ReDoS

### 調査結果

`query.type: "regex"` では、ユーザー指定の `query.text` を Node.js `RegExp` として扱う。

これは shell や SQL のような injection ではないが、正規表現そのものが実行されるため、意図しない広範囲 match や catastrophic backtracking による ReDoS のリスクがある。

### 現在の対策

- invalid regex は validation error `invalid_regex` として拒否する。
- regex pattern length は 1000 文字以下に制限し、超過時は `regex_too_large` として拒否する。
- `(.+)+` や `(a*)+` のような nested quantified group は `unsafe_regex` として拒否する。
- regex flags は public schema として受け取らない。
- content regex は行ごとに適用し、複数行 regex は MVP 外としている。
- `search.maxFileBytes`、`output.maxMatches`、`output.maxMatchesPerFile` に上限を設けている。

### 残リスク

Node.js の標準 `RegExp` は、pattern によっては 1 行の検索でも非常に時間がかかる可能性がある。現時点の nested quantified group reject は代表的な危険 pattern を拒否する最小 heuristic であり、完全な safe-regex 判定ではない。regex 実行単位の timeout は入れていない。

今後の対策候補:

- automation 向けに regex を無効化する実行モードを追加する。
- より厳密な safe-regex 判定を導入する。
- RE2 系 engine の利用を検討する。
- worker thread で regex 検索を実行し、timeout で中断する。

## Path traversal / root escape

### 調査結果

`request.root` は検索範囲を決める重要な入力である。相対 path、絶対 path、symlink を経由すると、探索中に `request.root` 配下ではない場所へ移動してしまう可能性がある。

Java でいう `Path.toRealPath()` や `File.getCanonicalPath()` に相当する処理として、Node.js では `fs.realpath()` を使う。単純な文字列 `startsWith(base)` では `/tmp/base` と `/tmp/base2` のような prefix 衝突を誤判定し得るため、`path.relative(base, candidate)` を使って配下判定する。

### 現在の対策

- `request.root` は `path.resolve(process.cwd(), root)` で絶対 path 化する。
- root は `fs.realpath()` で symlink 解決後の実体 path にし、この realpath を検索境界として扱う。
- root が filesystem root または user home directory の場合は `root_too_broad` として拒否する。
- 探索中の directory / file も `fs.realpath()` で解決し、検索 root 外に出る path は `path_escape_skipped` として skip する。
- symlink entry は通常探索対象にせず、`symlink_skipped` diagnostic として返す。

配下判定の基本形:

```ts
const base = await fs.realpath(baseDir);
const candidate = await fs.realpath(targetPath);
const relative = path.relative(base, candidate);
const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
```

## Symlink

### 調査結果

symlink は root escape の代表的な経路である。root 配下に見える path でも、実体が root 外にある場合がある。

### 現在の対策

- directory traversal 中に `Dirent.isSymbolicLink()` が true の entry は skip する。
- root 自体が symlink の場合も `fs.realpath()` で実体 path を確認する。
- 探索中の file read 前にも realpath 境界チェックを行う。

## TOCTOU

### 調査結果

現在の実装は、directory / file の `fs.realpath()` を確認した後に `fs.readdir()` や `fs.readFile()` を行う。このため、確認後から read 前までの短い間に file system entry が差し替えられる race condition は理論上残る。

### 現在の整理

`miku-grep` は local-first CLI であり、敵対的な別プロセスが同じ workspace を同時に書き換える状況を強い権限境界として防ぐ設計ではない。通常の agent / automation が自分の workspace を読む用途では、realpath 境界チェックと symlink skip を主対策とする。

より強い TOCTOU 対策が必要になった場合は、file descriptor ベースの open / fstat / read、platform ごとの `O_NOFOLLOW` 相当、または sandbox 側の読み取り権限制限を検討する。

## File size / binary / encoding

### 調査結果

巨大ファイル、binary file、decode 不能な file は、処理時間、メモリ、文字化け、後続処理の誤動作につながる。

### 現在の対策

- `search.maxFileBytes` default は 10 MiB。
- `search.maxFileBytes` の最大許容値は 100 MiB。
- `search.maxLineChars` default は 1000000、最大許容値は 10000000。
- decode 後の 1 行が `search.maxLineChars` を超える場合、その行は `max_line_chars_exceeded` として skip する。
- NUL byte を含む file は binary とみなし `binary_file_skipped` として skip する。
- 対応 encoding は `utf-8` と `shift_jis` に限定する。
- UTF-8 decode は fatal mode で行い、decode できない file は `decode_error` として skip する。
- Shift_JIS decode は明示的な encoding rule または default 指定に基づいて行う。

## Output size / resource limits

### 現在の対策

- `output.maxMatches` の最大許容値は 10000。
- `output.maxMatchesPerFile` の最大許容値は 1000。
- `output.maxLineLength` の最大許容値は 4000。
- `output.maxSnippetsPerFile` の最大許容値は 100。
- `search.maxDepth` の最大許容値は 50。
- `search.maxFilesVisited` の default は 100000、最大許容値は 1000000。
- `search.maxDirectoriesVisited` の default は 10000、最大許容値は 100000。
- limit 到達時は diagnostics に `max_matches`、`max_matches_per_file`、`max_snippets_per_file` を返す。
- traversal limit 到達時は diagnostics に `max_files_visited`、`max_directories_visited` を返す。

## Filename / diagnostics information disclosure

### 調査結果

filename search は file content を読まなくても root-relative path を返す。diagnostics も unreadable path、decode error、path escape、symlink skip など repository 構造に関する情報を返す。

これは agent が次に読むべき file を判断するためには有用だが、`miku-grep` を権限境界として使う場合には情報漏えいになる可能性がある。

### 現在の整理

`miku-grep` は local-first CLI であり、request.root 配下を読める caller が、その範囲の file / path 情報を得ることを前提にしている。権限のない user に対して result JSON をそのまま公開する用途は想定しない。

## Downstream injection / prompt injection

### 調査結果

`miku-grep` 自体は JSON として escape した result を返す。しかし caller が result 内の `text`、`matchedText`、`file`、diagnostics を shell、HTML、SQL、Markdown、prompt など別の文脈に再埋め込みする場合、その文脈での injection が発生し得る。

検索対象 file の本文は信頼できない入力である。agent が検索結果の本文をそのまま命令として扱うと prompt injection になる。

### 運用上の推奨

- caller は result JSON 内の文字列を再利用する文脈ごとに escape する。
- agent は検索結果本文を「観測データ」として扱い、system / developer instruction と同等の命令として扱わない。
- prompt に検索結果を入れる場合は、引用範囲や信頼境界を明示する。

## 現時点の主な残課題

- regex ReDoS 対策は追加検討が必要。
- `request.root` realpath 境界チェックを正式 CLI spec にも反映する。
- path escape の追加テストを symlink 以外の race condition 観点でも検討する。
- agent / MCP / skill から呼び出す場合の推奨 result handling contract を別途整理する。

## 変更履歴

- 2026-05-02: 初版作成。JSON injection、regex / ReDoS、root escape、symlink、file size、encoding、output limit の調査結果と対策を記録。
