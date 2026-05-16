---
name: add-book
description: Instagram (mazeltov7) を Claude in Chrome で開いて新規本を検出し、playground/my-books/books-data.json に追加してcommit&push する
user_invocable: true
arg: 省略可。指定があれば「Amazon URL [年]」を直接追加するモード
---

# add-book skill

ユーザーの読書ログ (https://mazeltov7.github.io/playground/my-books/) に新規本を追加するスキル。基本は **Instagram (mazeltov7) から自動検出** + 必要なら **手動 Amazon URL** で追加する。

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
5. 指定年（または当年）の配列末尾に entry を追加
6. JSON 妥当性検証
7. ローカルサーバ (port 8765) が起動していなければ起動して、Claude in Chrome で読み込み確認
8. 結果サマリ提示 → ユーザー確認
9. **enrich は自動実行**（ユーザーへ問わない）: 追加した全冊について `/enrich-book` のフロー（多角調査→反映）を **自動で実行** する。enrich-book 側のユーザー確認スキップ設計に従い、複数ソースで裏付けの取れた情報のみ books-data.json に書き込む（`notes/{KEY}.md` は作らない）
10. 追加 + enrich の変更をまとめて **1 つのコミット** にして commit & push（push 直前のユーザー確認は維持）

### モード2: Instagram 自動検出（引数なし）

引数なしで呼ばれた場合、Claude in Chrome で https://www.instagram.com/mazeltov7/ を開いて新規本を検出する。

**処理手順:**

1. **Chrome で Instagram プロフィール開く**
   - `mcp__claude-in-chrome__tabs_context_mcp` で既存タブ確認
   - 新規タブで `https://www.instagram.com/mazeltov7/` に navigate
   - ログインが必要な場合は「ブラウザで一度ログインしてから再実行してください」と告げて中断
   - ログイン済みなら投稿一覧が見える

2. **最近の投稿を抽出**
   - `mcp__claude-in-chrome__javascript_tool` で投稿リンク（`/p/...` URL）と各投稿のサムネイル alt/caption を取得
   - 直近 12〜24件を対象にする（ユーザーがインスタに月10冊上げる想定）
   - スクリーンショット (`mcp__claude-in-chrome__computer screenshot`) で書影が映ってるかも視覚確認

3. **本の識別**
   - キャプションから書名・著者を抽出（"📚" 絵文字や「読了」「読んだ」等のキーワードを目印に）
   - 書影の画像があれば Read tool で画像を見て、表紙のテキスト（書名・著者・出版社）を OCR
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
   - JSON 妥当性検証
   - ローカルブラウザで loaded 確認

8. **enrich は自動実行**（ユーザーへ問わない）
   - 追加した全冊について `/enrich-book` のフロー（多角調査→反映）を **自動で実行** する
   - enrich-book 側の設計（出典に複数ソースの裏付けがある情報のみ書き込む / `notes/{KEY}.md` は作らない）に従う

9. **commit & push**
   - 追加 + enrich の変更をまとめて 1 コミット
   - commit メッセージ例: `MyBooks: {N}冊追加 + enrich ({titles...})`
   - push して `mazeltov7.github.io` 本番へ反映（push 直前のユーザー確認は維持）

## entry のスキーマ

```json
{
  "title": "本のタイトル（必須、上下巻なら "(上)" "(下)" を末尾に付ける）",
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
- **メモリーファイル参照**: `/Users/yukiishikawa/.claude/projects/-Users-yukiishikawa-Products-mazeltov7/memory/project_book_covers.md` に過去の知見（プレースホルダー対応・bookmeter経由フォールバック等）が蓄積されているので、表紙取得で詰まったら参照
- **commit & push の前に必ずユーザー確認**を取る（自動 push しない）
- **enrich は add-book と同時に自動実行**する（A/B/C 等の毎回確認は不要）。enrich-book 側で複数ソース突き合わせ → 反映 → サマリ提示の流れに任せる

## ローカルサーバ起動コマンド

```bash
cd /Users/yukiishikawa/Products/mazeltov7/playground/my-books && python3 -m http.server 8765
```

URL: `http://localhost:8765/`
