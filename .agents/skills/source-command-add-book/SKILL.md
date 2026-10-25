---
name: "source-command-add-book"
description: "本の追加・add-book の依頼時に使用。Amazon URL指定またはInstagram (mazeltov7) の新規投稿からMyBooksへ登録し、時代背景・著者情報の補完と人類知マップへの反映を自動で行う。検証後、承認済みの範囲でcommit・pushする。"
---

# source-command-add-book

Use this skill when the user asks to run the migrated source command `add-book`.

## Command Template

# add-book skill

ユーザーの読書ログ (https://mazeltov7.github.io/playground/my-books/) に新規本を追加するスキル。基本は **Instagram (mazeltov7) から自動検出** + 必要なら **手動 Amazon URL** で追加する。

どちらのモードでも、追加した全冊について **enrich と人類知マップへの反映を自動実行**する。「マップにも追加するか」は毎回確認しない。ユーザーが対象や停止位置を指定した場合は、その指示を優先する。

## 2つの動作モード

### モード1: Amazon URL 指定（高速・確実）

引数に Amazon URL（複数可）と年（省略時は当年）が渡された場合、そのまま追加する。

例:
```
/add-book https://www.amazon.co.jp/dp/4488618030/
/add-book https://www.amazon.co.jp/dp/XXX/ 2026
/add-book https://www.amazon.co.jp/dp/A/ https://www.amazon.co.jp/dp/B/ 2025
```

**処理手順:**
1. URL から ASIN を抽出 (`/dp/XXXXXXXXXX/` の10桁/英数字部分)
2. ASIN から Amazon 商品ページを fetch しタイトル・著者・出版社をHTMLから抽出
3. cover URL を組み立て: `https://m.media-amazon.com/images/P/{ASIN}.jpg`
4. プレースホルダー（43B）戻り検査。43B なら商品ページから `https://m.media-amazon.com/images/I/{ImageID}.jpg` 形式を抽出して使う
5. 同じ年の既登録本をタイトル・著者・ASINで照合し、未登録なら指定年（または当年）の配列末尾に entry を追加。再実行時に重複を作らない
6. **enrich を自動実行**: 追加した全冊について、[enrich-bookスキル](../source-command-enrich-book/SKILL.md) の多角調査→反映を実施。複数ソースで裏付けの取れた情報のみ書く。ブラウザ確認・commit・push はこのスキルの共通工程へまとめる
7. 下記「共通工程: 人類知マップへの自動反映」を全冊に実施
8. 下記「共通工程: 検証と公開」を実施し、本の追加 + enrich + マップ反映を **1つのコミット** にまとめる

### モード2: Instagram 自動検出（引数なし）

引数なしで呼ばれた場合、Codex in Chrome で https://www.instagram.com/mazeltov7/ を開いて新規本を検出する。

**処理手順:**

1. **Chrome で Instagram プロフィール開く**
   - 利用可能なCodexのChrome接続で既存タブ・対象プロフィールを確認し、このタスクで作るタブのIDを記録
   - 新規タブで `https://www.instagram.com/mazeltov7/` に navigate
   - ログインが必要な場合は「ブラウザで一度ログインしてから再実行してください」と告げて中断
   - ログイン済みなら投稿一覧が見える

2. **最近の投稿を抽出**
   - Chrome接続のページ読み取り機能で投稿リンク（`/p/...` URL）と各投稿のサムネイル alt/caption を取得
   - 直近 12〜24件を対象にする（ユーザーがインスタに月10冊上げる想定）
   - スクリーンショットで書影も視覚確認

3. **本の識別**
   - キャプションから書名・著者を抽出（"📚" 絵文字や「読了」「読んだ」等のキーワードを目印に）
   - 書影の画像があれば表紙を見て、テキスト（書名・著者・出版社）を確認
   - 投稿日時から年を判定

4. **books-data.json と突合**
   - `playground/my-books/books-data.json` を読み、該当年の既存タイトルと比較
   - 既登録ならスキップ、新規なら追加候補リストに入れる

5. **新規候補ごとに Amazon ASIN 取得**
   - Amazon 検索 (`https://www.amazon.co.jp/s?k={title}+{author}&i=stripbooks`) を Chrome で navigate
   - 結果から最も合致する ASIN（10桁/英数字）と商品ページ URL を特定
   - cover URL: `https://m.media-amazon.com/images/P/{ASIN}.jpg` を生成、43B なら商品ページから `/I/{ImageID}.jpg` 形式へフォールバック

6. **追加候補をユーザーに提示**（必須）
   - 「以下の N 冊を追加します。承認しますか？」形式で年・タイトル・著者・出版社・cover URL を列挙
   - ユーザー承認後に実際に書き込み

7. **books-data.json に追加**
   - 該当年配列の末尾に entry を append
   - 再実行時は既登録本を再追加しない

8. **enrich は自動実行**（ユーザーへ問わない）
   - 追加した全冊について、[enrich-bookスキル](../source-command-enrich-book/SKILL.md) の多角調査→反映を **自動で実行** する
   - enrich-book 側の設計（出典に複数ソースの裏付けがある情報のみ書き込む）に従う
   - ブラウザ確認・commit・push はこのスキルの共通工程へまとめる

9. **人類知マップへの反映・検証・公開**
   - 以下の共通工程を全冊に実施し、追加 + enrich + マップ反映を1コミットにまとめる

## 共通工程: 人類知マップへの自動反映

### 1. 対象と既存仕様を確認

- 今回追加した全冊を対象にする。途中からの再開では、登録済みでも今回の対象本にマップ対応が欠けていれば補完する。
- `playground/knowledge-map/README.md`、`periods/manifest.json`、対象データ、照合処理 `period-model.mjs` を読む。以下のパスはすべて `playground/knowledge-map/` 配下。
- 全体マップは `data.json` の `entries` / `bookLinks` と `data.details.json` を更新する。**books-data.json への追加だけでは全体マップへの反映は完了しない。**
- 時代別ビューは manifest の対象期間を確認し、該当する `periods/{id}.json` と `periods/{id}.explore.json` を更新する。現在の `meiji-ww2` は1850〜1945年。期間外の現代書を無理に配置しない。

### 2. 作品と年代を確定して接続

- enrich の調査結果を利用し、原著刊行・初出・連載開始など、既存年表の規則に沿う年に配置する。読了年、翻訳・文庫・電子版の発売年、物語の舞台年代とは区別し、採用した年の意味を解説と出典に残す。
- タイトルの表記揺れと著者を照合し、同じ作品の既存項目があればそのIDを再利用する。MyBooksと年表で採用する年代が違っても、根拠があれば既存年表の年を上書きしない。
- 新規項目は既存のカテゴリー・地域・レーンとデータ形式に合わせ、安定したIDを付ける。全体・時代別に同じ作品を追加する場合は、既存IDとの整合を優先する。
- `bookLinks` に `{ "entryId": "対象ID", "title": "MyBooksの書名", "author": "MyBooksの著者名" }` を追加する。書名・著者名は `books-data.json` からそのまま転記し、同じ対応を重複登録しない。全体と該当する時代別の両方で接続を確認する。
- 作品の解説・著者情報・テーマ・出典も補う。全体の `data.details.json` は項目ごとの `sources` 配列、時代別の `.explore.json` は `sources` 辞書と各項目の `sourceIds` を使うため、形式を混同しない。無根拠な影響関係は追加しない。
- 年代などを裏付けられない場合は捏造せず、独立して反映できる本の作業を進め、未反映の本と不足情報を最後に明示する。

### 3. 合本・再読・解説書を区別

- **合本**: 表題作品と、すでにマップにある主要な収録作品を確認し、作品ごとに同じ書名・著者の `bookLinks` を持たせる。各作品の初出年を使い、合本全体に代表作の年を一律設定しない。全収録作品を扱わない場合は、その範囲を報告する。
- **再読**: 読了年ごとの記録を保持し、作品項目や対応表は重複させない。合本の複数作品への接続も含め、冊数は既存の書籍IDによる集計に従う。
- **現代の解説書**: 全体マップでは解説書自身をその原著刊行年で登録し、通常の `bookLinks` で読書記録に接続する。対象原典にも `{ "entryId": "原典ID", "title": "解説書の書名", "author": "解説書の著者名", "kind": "commentary" }` を追加する。
- 原典が時代別ビューの期間内なら、解説書が期間外でも、そのビューの原典へ `kind: "commentary"` で接続する。原典が未登録なら根拠を調査して補う。全体マップでは既存形式の `relatedEntries` で原典と解説書を相互に辿れるようにする。
- **解説書を読んだだけで原典を読了扱いにしない。** 原典側では `relatedBookRecords` に入り、`bookRecords` や「読んだ本だけ」の対象、通常の読了冊数に混ざらないことを確認する。

## 共通工程: 検証と公開

1. 変更したJSONをパースし、作品ID・出典ID・`bookLinks` の参照先と書名・著者、MyBooksへのリンクを確認する。既存の読書記録を保持し、項目や対応表に重複がないことも確認する。
2. `lastUpdated` / `reviewedAt`、READMEの現在件数、既存テストの期待件数は、該当するデータ変更に応じて更新する。実データから集計し、失敗を隠すために期待値だけを変えない。
3. リポジトリのルートで以下を実行する。JavaScriptを変更した場合は、変更ファイルの構文確認も行う。

   ```sh
   node --test playground/knowledge-map/period-model.test.mjs
   git diff --check
   ```

4. 下記のルート配信サーバーを利用し、ブラウザで実表示を確認する。既存サーバーが別ディレクトリを配信している場合は停止・流用せず、空きポートを使う。
   - MyBooks: 各追加本の表紙、詳細、時代背景・著者情報。
   - 全体マップ: 各追加本を書名で検索でき、詳細から正しいMyBooksページへ移動できること。
   - 該当する時代別ビュー: 初出年、合本の作品別接続、再読の冊数、原典の関連書表示。「読んだ本だけ」に解説書経由の原典が混入しないこと。
5. 追加冊数、マップへの接続、未解決事項を簡潔に報告する。登録 + enrich + マップの変更を1コミットにまとめる。例: `MyBooks: {N}冊を追加し人類知マップへ反映`。
6. **commit・push・本番反映はユーザーが承認した範囲で実行する。** 同じ依頼ですでに承認されていれば再確認しない。未承認なら変更と検証を完成させてから確認する。自動のマップ反映自体を、未承認の公開への許可とは扱わない。
7. 本番反映まで依頼されている場合は、push後のデプロイ成功と本番の表示を確認する。このタスクで開いたタブと起動した一時サーバーを整理してから完了を報告する。

## entry のスキーマ

```json
{
  "title": "本のタイトル（必須、上下巻なら「(上)」「(下)」を末尾に付ける）",
  "titleEn": "英語版タイトルがあれば（任意）",
  "author": "著者名（必須）",
  "publisher": "出版社（任意・JP出版社の場合は記入推奨）",
  "cover": "https://m.media-amazon.com/images/P/{ASIN}.jpg"
}
```

## 重要な実装上の注意

- **上下巻ものは1エントリにまとめず、別エントリで登録する**（過去の合意）。検索結果で「全X巻の第N巻」表記を見かけたら分割を提案
- **publisher が日本の出版社なのに Google Books が英語原書を返した場合**は、必ず Amazon JP の日本語訳版 ASIN を採用
- **同じ本でも複数版がある場合**: Kindle (B0...) を優先。理由: 装丁の帯がない綺麗な表紙が多いため。ただし司馬遼太郎シリーズなど、シリーズ全巻 Kindle で揃えられるかを確認
- **メモリーファイル参照**: `/Users/yukiishikawa/.Codex/projects/-Users-yukiishikawa-Products-mazeltov7/memory/project_book_covers.md` に過去の知見（プレースホルダー対応・bookmeter経由フォールバック等）が蓄積されているので、表紙取得で詰まったら参照
- **enrich と人類知マップへの反映は add-book と同時に自動実行**する（毎回確認は不要）。公開の承認は上記の共通工程に従う

## ローカルサーバ起動コマンド

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory /Users/yukiishikawa/Products/mazeltov7
```

URL:

- MyBooks: `http://127.0.0.1:8765/playground/my-books/`
- 全体マップ: `http://127.0.0.1:8765/playground/knowledge-map/`
- 近代の詳細ビュー: `http://127.0.0.1:8765/playground/knowledge-map/period.html?id=meiji-ww2`
