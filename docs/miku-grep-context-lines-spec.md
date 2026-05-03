# miku-grep Context Lines Specification

## 目的

この文書は、`miku-grep` の content hit に match 前後の context lines を返す実装済み仕様をまとめる。

目的は、生成AI agent が検索結果だけで周辺文脈を判断しやすくすることである。

## 背景

現行の `detail` mode は content hit ごとに line、column、matchedText、text snippet を返す。

しかし match 行だけでは、生成AI agent が次に読むべき file / 箇所を判断するには情報が足りない場合がある。多くの場合、agent は検索後に同じ file を読み直して前後行を確認する。

context lines を `detail` result に含めることで、検索結果だけで判断できる範囲を広げる。

## 方針

- context lines は `output.mode: "detail"` 限定とする。
- context lines は `type: "content"` hit にだけ付ける。
- `type: "filepath"` hit には context field を付けない。
- `type: "directory"` hit には context field を付けない。
- `output.mode: "summary"` で context option を指定した場合は validation error とする。
- `output.mode: "detail"` で `search.targets` に `content` が含まれない場合でも、context option 指定は validation error にしない。

理由:

- `summary` は候補 file / directory を絞るための compact overview として保つ。
- context lines は hit 単位の情報であり、`detail` mode に属する。
- `summary` に context を入れると result が大きくなり、`snippets` との責務も曖昧になる。
- agent が共通 request template で context option を付けても、filepath / directory search はそのまま動く方が扱いやすい。

## request JSON

### symmetric context

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
  "output": {
    "mode": "detail",
    "contextLines": 2
  }
}
```

`contextLines` は match 行の前後に同じ数の context line を返す shorthand である。

### asymmetric context

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
  "output": {
    "mode": "detail",
    "contextLinesBefore": 3,
    "contextLinesAfter": 1
  }
}
```

`contextLinesBefore` と `contextLinesAfter` は前後で異なる行数を指定する。

## 同時指定ルール

`contextLines` と `contextLinesBefore` / `contextLinesAfter` は同時指定できない。

次の request は validation error とする。

```json
{
  "output": {
    "mode": "detail",
    "contextLines": 2,
    "contextLinesBefore": 1
  }
}
```

理由:

- request の意味を曖昧にしない。
- typo や agent-generated JSON の混乱を早く検出する。
- 既存方針である unknown / invalid request を黙って無視しない設計と合う。

## default / limit

```json
{
  "output": {
    "contextLinesBefore": 0,
    "contextLinesAfter": 0
  }
}
```

default は context なしである。

最大値:

```text
contextLines: 20
contextLinesBefore: 20
contextLinesAfter: 20
```

上限超過時は validation error とする。

追加 validation code:

```text
context_lines_too_large
invalid_context_lines
```

`invalid_context_lines` は次の場合に使う。

- `contextLines` / `contextLinesBefore` / `contextLinesAfter` が integer ではない
- `contextLines` と `contextLinesBefore` / `contextLinesAfter` が同時指定された
- `output.mode: "summary"` で context option が指定された

`context_lines_too_large` は context line count が最大値を超えた場合に使う。

## result JSON

content hit に `contextBefore` / `contextAfter` を追加する。

```json
{
  "type": "content",
  "file": "src/App.java",
  "line": 42,
  "column": 7,
  "matchedText": "RepositoryMap",
  "text": "class RepositoryMap {",
  "trimmed": false,
  "contextBefore": [
    {
      "line": 40,
      "text": "package example;",
      "trimmed": false
    },
    {
      "line": 41,
      "text": "",
      "trimmed": false
    }
  ],
  "contextAfter": [
    {
      "line": 43,
      "text": "  RepositoryMap field;",
      "trimmed": false
    },
    {
      "line": 44,
      "text": "}",
      "trimmed": false
    }
  ],
  "encoding": "utf-8",
  "encodingRule": {
    "type": "default"
  }
}
```

context line item:

```json
{
  "line": 43,
  "text": "  RepositoryMap field;",
  "trimmed": false,
  "textStartColumn": 1
}
```

`textStartColumn` は context line が trim され、元 line の途中から始まる場合だけ返す。

context option 未指定時は `contextBefore` / `contextAfter` を返さない。

context option 指定時は、content hit に `contextBefore` / `contextAfter` を返す。file 先頭 / 末尾で前後行が存在しない場合は空配列を返す。

## maxLineLength との関係

`output.maxLineLength` は match line の `text` だけでなく、context line の `text` にも適用する。

context line が `maxLineLength` を超える場合:

- `text` は source file 由来の文字だけを返す
- artificial ellipsis は入れない
- `trimmed: true` を返す
- 先頭から切らない場合は `textStartColumn` を返す

match line は match 中心 snippet を作る。

context line は match position を持たないため、原則として line 先頭から `maxLineLength` までを返すのが自然である。

## count / truncation との関係

context lines は hit ではない。

- `summary.matches` に数えない
- `output.maxMatches` に数えない
- `output.maxMatchesPerFile` に数えない

file 先頭 / 末尾により指定行数より context が短くなる場合は diagnostics を出さない。

context line 自体が `search.maxLineChars` を超える場合は、その context line を返さず、`max_line_chars_exceeded` diagnostic を返す。

検索対象 line と同じ safety policy に揃える。

## summary mode との関係

`summary` mode には context lines を載せない。

理由:

- `summary` は候補 file / directory を絞る compact overview である。
- `summary.snippets` は representative snippet であり、hit 前後の厳密な context ではない。
- directory match と file summary が混在するため、context を載せると result shape が複雑になる。

次の request は validation error とする。

```json
{
  "output": {
    "mode": "summary",
    "contextLines": 2
  }
}
```

## filepath / directory target との関係

`detail` mode で context option が指定されていても、`filepath` / `directory` hit には context field を付けない。

次の request は valid とする。

```json
{
  "search": {
    "targets": ["filepath", "directory"]
  },
  "output": {
    "mode": "detail",
    "contextLines": 2
  }
}
```

この場合、filepath / directory hit は通常通り返る。content hit がなければ context field は出ない。

## 実装決定

- field 名は `contextLines` / `contextLinesBefore` / `contextLinesAfter` とする。
- default は `0`。
- 最大値は `20`。
- `contextLines` と `contextLinesBefore` / `contextLinesAfter` の同時指定は `invalid_context_lines`。
- `output.mode: "summary"` で context option が指定された場合は `invalid_context_lines`。
- context line count の上限超過は `context_lines_too_large`。
- context option 未指定時は `contextBefore` / `contextAfter` を返さない。
- context option 指定時は content hit に `contextBefore` / `contextAfter` を返す。
- context option 指定時、file 先頭 / 末尾で前後行が存在しない場合は空配列を返す。
- filepath / directory hit には context field を付けない。
- context line は `output.maxLineLength` で line 先頭から trim する。
- context line が `search.maxLineChars` を超えた場合は `max_line_chars_exceeded` diagnostic を返し、その context line は省略する。
- context lines は `summary.matches` / `output.maxMatches` / `output.maxMatchesPerFile` に数えない。

## 判断メモ

破壊的変更が許される場合でも、context lines は `detail` 限定がよい。

`summary` は compact overview、`detail` は hit 単位の文脈確認という責務分担を保つ方が、生成AI agent にも説明しやすく、result size も制御しやすい。
