# Policy-Aware Search Requirements Memo

## 目的

この文書は、`miku-grep` または周辺 tool における policy-aware search 強化の要求を整理する。

policy-aware search とは、単に query に match する file を返すだけでなく、検索対象 file の安全性、生成物らしさ、機密情報らしさ、agent に渡す際の注意点を policy として扱い、skip / warning / diagnostics / override guidance を構造化して返す考え方である。

現時点では、この内容は `miku-grep` の正式 request schema ではない。将来検討のための要求メモとして扱う。

## 背景

生成AI agent や automation が repository を検索するとき、検索 hit だけを返すと次のような問題が起きる。

- `.env` や秘密鍵など、読ませるべきでない file が検索対象になる
- generated file や build output が大量に hit し、本来読むべき source file が埋もれる
- lock file や minified file など、agent が読む価値の低い file が token budget を消費する
- prompt injection を含む可能性のある文書を、agent が命令として扱ってしまう
- なぜ file が skip されたか、どう override すれば読めるかが result から分からない

既存の `miku-grep` は default exclude preset、root realpath 境界、symlink skip、file size limit、binary skip、decode diagnostics などの基礎的な safety を持つ。

policy-aware search は、これらをより明示的な policy として整理し、agent / automation が検索結果を安全に扱いやすくする方向である。

## 対象

扱う policy 候補:

- secret-looking file policy
- credential-looking file policy
- generated file policy
- dependency / build output policy
- lock file policy
- binary / large file policy
- prompt-injection-risk policy
- allowlist / denylist policy
- automation-safe preset
- override guidance

扱わないもの:

- 完全な secret scanning
- DLP 製品相当の検出
- malware scanning
- content moderation
- LLM による file safety 判定
- remote policy service への問い合わせ
- repository の権限管理

## 現行 `miku-grep` との関係

現行 `miku-grep` に既にある safety / policy 的な挙動:

- default exclude preset
- root が広すぎる場合の拒否
- root realpath 境界外への path escape skip
- symlink skip
- max file size
- max line chars
- binary file skip
- decode error diagnostics
- regex pattern length limit
- unsafe regex heuristic reject
- output match limit

policy-aware search は、これを次の方向に拡張する候補である。

- policy preset を request で選べる
- skip ではなく warning として返す policy を選べる
- policy による判断理由を diagnostics に明示する
- override するための request field を明示する
- agent 向けに「読んでよい / 注意して読む / 読まない」を区別する

## policy preset 案

### default

通常の `miku-grep` default に近い preset。

目的:

- grep 代替として自然に使う
- `.git`、`node_modules`、`dist` などのノイズを避ける
- 機密らしい file は warning か skip の候補にする

### safe-agent-default

生成AI agent / automation 向けの保守的な preset。

目的:

- secret-looking file を原則 skip
- dependency / build output を原則 skip
- generated file を warning または skip
- prompt injection risk を diagnostics に出す
- override なしでは危険 file を content search しない

### permissive-local

local user が明示的に広く検索したい場合の preset。

目的:

- default exclude は薄くする
- secret-looking file は skip ではなく warning にする
- user が local で明示的に読む判断をしやすくする

### strict

CI / automation などで誤読を避けたい preset。

目的:

- secret-looking file は hard skip
- generated / dependency / large file は hard skip
- unknown or risky file は warning 以上にする
- override は明示 allowlist のみ許可する

## request JSON 案

```json
{
  "version": 1,
  "root": ".",
  "query": {
    "type": "literal",
    "text": "API_KEY"
  },
  "search": {
    "target": "content"
  },
  "policy": {
    "preset": "safe-agent-default",
    "secretLikeFiles": "skip",
    "generatedFiles": "warning",
    "dependencyDirectories": "skip",
    "lockFiles": "warning",
    "promptInjectionRisk": "diagnostic",
    "allowFileNamePatterns": [],
    "denyFileNamePatterns": [],
    "allowPathPatterns": [],
    "denyPathPatterns": [],
    "explainOverrides": true
  }
}
```

### policy action

各 policy の action 候補:

```text
ignore
  policy 判定を行わない

diagnostic
  検索は続行し、diagnostics に情報として返す

warning
  検索は続行し、warning diagnostics に返す

skip
  対象を検索せず、skipped diagnostics に返す

error
  request または検索を expected failure として止める
```

MVP では `diagnostic` / `warning` / `skip` だけでもよい。

## policy 種別

### secret-like files

秘密情報を含む可能性が高い file name / path を扱う。

候補 pattern:

```text
.env
.env.*
*.pem
*.key
*.p12
*.pfx
id_rsa
id_dsa
id_ecdsa
id_ed25519
credentials*
*credential*
*secret*
*token*
```

注意:

- file name pattern のみでは false positive / false negative が多い
- MVP では content secret scanning はしない方がよい
- content を読まずに skip できることが重要

### generated files

人間や agent が直接読む価値が低い生成物を扱う。

候補 pattern:

```text
*.generated.*
*.min.js
*.bundle.js
dist/
build/
target/
coverage/
```

generated docs は製品によって扱いが異なる。例えば API docs や generated Markdown は useful な場合もあるため、default では `warning` が自然である。

### dependency directories

外部依存や vendored source を扱う。

候補:

```text
node_modules
vendor
.gradle
.m2
```

`vendor` は repository によっては product source として重要な場合がある。default skip にする場合も、override guidance が必要である。

### lock files

lock file を扱う。

候補:

```text
package-lock.json
pnpm-lock.yaml
yarn.lock
Cargo.lock
Gemfile.lock
poetry.lock
```

lock file は依存調査では重要だが、通常の source reading ではノイズになりやすい。default は `warning` または `diagnostic` が自然である。

### prompt injection risk

agent に渡すときに、file content を命令として扱ってはいけないことを diagnostics で明示する。

候補:

- Markdown / text / HTML など natural language を含む file
- `prompt`, `instruction`, `system`, `agent`, `jailbreak` などを file name に含む file
- external content を取り込んだ docs

重要:

- prompt injection risk は file を危険物として断定するものではない
- agent が検索結果本文を observation として扱うための warning である
- MVP では content 解析ではなく path / extension / file name による weak signal にとどめる

## diagnostics 案

policy による判断は diagnostics に構造化して返す。

```json
{
  "severity": "warning",
  "code": "policy_secret_like_file",
  "message": "file looks like it may contain secrets and was skipped by policy",
  "file": ".env",
  "skipped": true,
  "details": {
    "policy": "secretLikeFiles",
    "action": "skip",
    "matchedPattern": ".env",
    "override": {
      "field": "policy.allowFileNamePatterns",
      "example": [".env"]
    }
  }
}
```

diagnostic code 候補:

```text
policy_secret_like_file
policy_credential_like_file
policy_generated_file
policy_dependency_directory
policy_lock_file
policy_prompt_injection_risk
policy_denied_path
policy_allowed_override
policy_override_required
invalid_policy
invalid_policy_action
invalid_policy_preset
```

## override guidance

policy-aware search では、単に skip するだけでなく、明示的に読むための方法を diagnostics に返すと agent / automation が扱いやすい。

例:

```json
{
  "details": {
    "override": {
      "reason": "To search this file, explicitly allow the file name pattern.",
      "field": "policy.allowFileNamePatterns",
      "example": ["*.pem"]
    }
  }
}
```

ただし secret-like file については、override guidance を出しすぎると危険な自動読み取りを促す可能性がある。`safe-agent-default` では guidance を簡潔にし、user の明示指示を必要とするのがよい。

## result summary 案

summary に policy 関連 count を追加する案。

```json
{
  "summary": {
    "filesVisited": 120,
    "filesScanned": 80,
    "filesMatched": 4,
    "matches": 10,
    "diagnostics": 6,
    "policy": {
      "preset": "safe-agent-default",
      "filesSkippedByPolicy": 3,
      "filesWarnedByPolicy": 2,
      "directoriesSkippedByPolicy": 1
    },
    "truncated": false,
    "truncatedReason": null
  }
}
```

既存 `summary` との互換性を考えると、`summary.policy` のような nested field が自然である。

## MVP 案

MVP で扱うもの:

- `policy.preset`
- `safe-agent-default`
- secret-like file name skip
- dependency / build directory skip
- generated file warning
- lock file warning
- prompt-injection-risk diagnostic
- policy diagnostics

MVP で扱わないもの:

- content-based secret scanning
- LLM-based risk classification
- complex rule language
- organization policy file
- remote policy fetch
- per-language generated file detection

## 実装上の注意

- policy 判定は file read 前にできるものを優先する
- content を読む必要がある policy は MVP では避ける
- default exclude preset と policy preset の責務を混ぜすぎない
- policy による skip と include / exclude による skip の diagnostic code を分ける
- user が `excludeFileNamePatterns: []` を指定した場合と policy skip の関係を明確にする
- secret-like file は `output.mode` に関わらず content read 前に止める
- policy diagnostics は stable order で返す
- false positive を前提に override 可能にする

## 未決事項

- `miku-grep` 本体に入れるか、別 wrapper / policy layer にするか
- `policy` field を request schema v1 に追加するか、schema v2 とするか
- default preset に policy を含めるか、明示 opt-in にするか
- secret-like file の default action を `warning` にするか `skip` にするか
- generated docs を generated file として扱うか
- prompt injection risk をどの程度検出するか
- diagnostics の override guidance をどこまで具体的にするか

## 判断メモ

利用者向け README に `policy-aware search の強化` とだけ書くと意味が曖昧である。

正式仕様化するまでは、README の後続候補に残すより、この文書や `TODO.md` で「要求整理中」として扱う方がよい。

`miku-grep` の grep 代替としての単純さを守るなら、policy-aware search は opt-in preset として追加するのが自然である。一方、Agent Skills から呼ぶ通常経路では `safe-agent-default` を使う、という分担も考えられる。
