---
name: memo
description: 指定した本の notes/{KEY}.md にメモを追記/編集。引数なしなら追記対象を選ばせる
user_invocable: true
arg: 本のタイトル（部分一致可）+ 任意でメモ本文。メモ本文がなければ既存メモを表示してユーザーに何を追記するか聞く
---

# memo skill

MyBooks 詳細ページ（`book.html`）の「自分のメモ」欄に表示される `notes/{KEY}.md` を追記/編集する。

## 呼び方

```
/memo                              # 全本リストから選択モード
/memo {タイトル一部}              # 該当本の既存メモを表示 → 何を追記するか聞く
/memo {タイトル一部} "メモ本文"   # 直接追記
```

## 処理フロー

### 1. 本の特定（タイトル部分一致）

- 引数のタイトル文字列で `playground/my-books/books-data.json` を検索
- ヒット 0: 「該当本なし」と告げて終了
- ヒット 1: そのまま続行
- ヒット 2+: 候補列挙してユーザーに番号選択させる
- 引数なし: 全本のリスト（年・タイトル）を表示して選ばせる（多すぎる場合は最近の年だけ）

### 2. KEY 算出

`enrich-book` と同じロジック:
1. `cover` が `https://m.media-amazon.com/images/P/{ASIN}.jpg` → `{ASIN}`
2. それ以外 → `title.replace(/[\/\\?#&%]+/g, '-')`

### 3. 既存メモの確認

- `playground/my-books/notes/{KEY}.md` を Read
- 存在すれば内容を表示
- 存在しなければ「メモはまだない」と告げて新規作成モードへ

### 4. メモ本文を取得

**a) 引数で本文が渡されている場合:**
そのまま追記内容として使う。

**b) 引数で本文がない場合:**
ユーザーに「何を追記しますか？ Markdown OK」と聞いて入力を待つ。

### 5. 追記/新規作成

- **既存メモあり**: 既存内容の末尾に空行を 1 つ挟んで追記
- **既存メモなし**: 以下の最小構成で新規作成（テンプレ見出しは入れない、本文だけ）

```markdown
# {タイトル}

{ユーザーのメモ}
```

セクション分けはユーザーが書きたいときに自分で書く（`## 印象` `## 考え` などの空見出しを勝手に作らない）。

### 6. ブラウザで反映確認

- localhost:8765 が動いてなければ起動: `cd playground/my-books && python3 -m http.server 8765`
- Claude in Chrome で `http://localhost:8765/book.html?id={KEY}` を navigate
- メモ欄に追記内容が反映されているか確認

### 7. commit & push（ユーザー確認後）

- 変更ファイル: `playground/my-books/notes/{KEY}.md`
- commit メッセージ例: `MyBooks: 「{タイトル}」のメモを更新`
- push して `mazeltov7.github.io` 本番反映

## 重要な実装上の注意

- **既存メモを勝手に書き換えない**: 上書きはせず必ず追記。既存内容を編集したい場合はユーザーに「既存のここを→こう書き換える」を明示してもらう
- **commit & push の前に必ずユーザー確認**
- **長い本文は HEREDOC で安全に書き込む**: シェルで echo を使わず Write/Edit ツールで直接書く
- **enrich-book との関係**: メモ欄と「時代背景/著者プロフィール」は独立。`/memo` はメモ欄のみ、`/enrich-book` は周辺メタ情報のみ

## ローカルサーバ起動コマンド

```bash
cd /Users/yukiishikawa/Products/mazeltov7/playground/my-books && python3 -m http.server 8765
```

URL: `http://localhost:8765/book.html?id={KEY}`
