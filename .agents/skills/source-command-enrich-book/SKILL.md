---
name: "source-command-enrich-book"
description: "指定した本について Wikipedia / Google Books / Web Search を総合調査し、時代背景・著者プロフィール・テーマタグの下書きを提示。承認分のみ books-data.json に反映"
---

# source-command-enrich-book

Use this skill when the user asks to run the migrated source command `enrich-book`.

## Command Template

# enrich-book skill

MyBooks 詳細ビュー（`book.html?id=...`）に表示する周辺情報を「**毎回ちゃんと調査 → 出典付きで提示 → ユーザー承認 → 採用分だけ反映**」のフローで充実させる。

## データ拡張先のスキーマ

`playground/my-books/books-data.json` の各 entry に以下フィールドを追加（任意・部分追加可）:

```json
{
  "title": "...", "author": "...", "publisher": "...", "cover": "...",
  "publishedYear": 1957,
  "era": "...時代背景の説明（Markdown 可）...",
  "authorBio": {
    "born": 1927,
    "died": 1996,
    "summary": "...著者プロフィール（Markdown 可）..."
  },
  "themes": ["タグ1", "タグ2", "タグ3"]
}
```

## KEY 算出ルール

`book.html` / `index.html` の `bookKey()` と一致させる:
1. `cover` が `https://m.media-amazon.com/images/P/{ASIN}.jpg` 形式 → `{ASIN}`（10桁英数字）
2. 上記以外 → `title.replace(/[\/\\?#&%]+/g, '-')`

## 処理フロー

### 1. 本の特定（タイトル部分一致）

- 引数のタイトル文字列で `playground/my-books/books-data.json` 全年を検索
- ヒット 0 件: 「該当本なし」と告げて終了
- ヒット 1 件: そのまま続行
- ヒット 2+ 件: 全候補を「年・タイトル・著者」で列挙してユーザーに番号選択させる

### 2. 多角的に調査（**毎回必ず実施**）

以下のソースを **複数組み合わせて** 調査する。1つのソースで決めず、必ず突き合わせる:

1. **Wikipedia 日本語版** (`ja.wikipedia.org`): 著者・本のページを WebFetch
2. **Wikipedia 英語版** (`en.wikipedia.org`): 海外の本・著者は英語版がより充実
3. **Google Books API** (`https://www.googleapis.com/books/v1/volumes?q=...`): description / publishedDate
4. **WebSearch**: 時代背景・出版経緯・書評・作者の制作背景など補足情報
5. **必要に応じて context7**: 近現代のテック書ならドキュメント・公式情報

各情報には **出典 URL** をメモしておく。

### 3. 下書き作成

以下を **Markdown 形式の下書き** として組み立てる:

- **publishedYear**: 原著の発行年（数値、例: 1957）
- **era**: 時代背景。執筆当時の社会情勢・出版経緯・本の意義を 2-4 段落
- **authorBio**:
  - born / died: 数値年（生没年。健在なら died 省略）
  - summary: 著者プロフィール 1-3 段落（経歴ハイライト・代表作・本書執筆時の立場）
- **themes**: 3-6 個のタグ（例: `["明治維新", "幕末志士", "歴史小説"]`）

### 4. そのまま反映（ユーザー確認スキップ）

下書きが完成したら、出典に複数ソースの裏付けがある前提で **直接 books-data.json に反映** する。1冊あたり Wikipedia 等で確実に取れた情報のみ書く（捏造禁止）。

- `books-data.json` 該当 entry に採用分のフィールドを追加
- JSON 妥当性検証（`python3 -m json.tool`）

### 5. 反映後にサマリ提示

複数冊まとめて enrich する場合は、最後に「N冊反映済み: タイトル一覧」を簡潔に提示。情報が見つからなかったフィールドがあればそれも明示（例: 「{書名} は publishedYear 不明のためスキップ」）。

ユーザーから「これは違う」「修正したい」とあれば随時修正対応。基本は走らせきって最後に確認の流れ。

### 6. ブラウザで動作確認

- localhost:8765 が動いてなければ起動: `cd playground/my-books && python3 -m http.server 8765`
- Codex in Chrome で `http://localhost:8765/book.html?id={KEY}` を navigate して読み込み確認
- スクリーンショットで時代背景 / 著者バイオ の表示を視覚確認

### 7. commit & push（ユーザー確認後）

- 変更ファイル: `playground/my-books/books-data.json`
- commit メッセージ例: `MyBooks: 「{タイトル}」に時代背景・著者情報を追加`
- push して `mazeltov7.github.io` 本番反映

## 重要な実装上の注意

- **必ず複数ソースを突き合わせる**: 単一ソースで決定しない。Wikipedia と Google Books が食い違ったら両方確認し、確実な方を採用
- **不明な項目は無理に埋めない**: 例えば著者の生没年が不明なら born/died を省略して summary だけにする。捏造禁止
- **既存フィールドの上書き**: すでに `era` などがある本を再 enrich する場合、必ず「既存値があります、上書きしますか？」と確認
- **commit & push の前に必ずユーザー確認**を取る（自動 push しない）

## ローカルサーバ起動コマンド

```bash
cd /Users/yukiishikawa/Products/mazeltov7/playground/my-books && python3 -m http.server 8765
```

URL: `http://localhost:8765/book.html?id={KEY}`
