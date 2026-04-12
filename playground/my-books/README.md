# My Books

Instagramストーリーに記録してきた読書ログを本棚UIで表示するページ。

## 構成

- `index.html` — 本棚UI（Pure HTML + CSS + Vanilla JS）
- `books-data.json` — 書籍データ（タイトル・著者・出版社・表紙URL）

## 書籍データの追加

`books-data.json` に年ごとの配列で追加する。

```json
{
  "title": "本のタイトル",
  "titleEn": "English Title (あれば)",
  "author": "著者名",
  "publisher": "出版社 (あれば)",
  "cover": "https://..."
}
```

## 表紙画像の取得

### Google Books API（メイン）

APIキー不要。タイトル+著者で検索し、サムネイルURLを取得する。

```
https://www.googleapis.com/books/v1/volumes?q=intitle:TITLE+inauthor:AUTHOR&maxResults=3
```

レスポンスの `items[].volumeInfo.imageLinks.thumbnail` から画像URLを得る。

画像URL形式:
```
https://books.google.com/books/content?id=XXX&printsec=frontcover&img=1&zoom=N
```

### zoom パラメータとプレースホルダー問題

| zoom | 解像度 | プレースホルダー |
|------|--------|-----------------|
| 3 | 高 | 9,103B の真っ黒画像 |
| 2 | 中 | 15,567B の "image not available" 画像 |
| 1 | 低 | 比較的安全だがぼやける |

**注意:** プレースホルダーは HTTP 200 で正常に返るため、ステータスコードでは判別不可。ファイルサイズで判定する。

### 推奨手順

1. `zoom=3` で取得
2. ファイルサイズが **9,103B** → `zoom=1` にフォールバック
3. それも **9,103B** or **15,567B** → Open Library API を試す
4. それでもなければ `cover` フィールドを省略（UIがタイトルテキストでフォールバック表示）

### Open Library API（フォールバック）

```
https://openlibrary.org/search.json?title=TITLE&limit=3
```

レスポンスの `docs[].cover_i` から画像URL構築:
```
https://covers.openlibrary.org/b/id/{cover_id}-L.jpg
```

日本の書籍カバレッジは低め。

### 現状 (2026-04-13)

- 234/256冊 (91.4%)
- 未取得22冊はGoogle Books / Open Library両方に画像がない日本のマイナー書籍
