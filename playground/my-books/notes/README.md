# Notes

各本の個人メモ Markdown を `{KEY}.md` で保存するディレクトリ。

## KEY の決め方

- **Amazon ASIN がある本**: `cover` URL の `https://m.media-amazon.com/images/P/{ASIN}.jpg` の `{ASIN}` 部分（10桁の英数字）。例: `4488618030.md`
- **ASIN がない本（Google Books cover など）**: タイトル文字列を `/`, `\`, `?`, `#`, `&`, `%` を `-` に置換したもの。例: `WATCHMEN.md`

## メモ書式テンプレ

```markdown
# {タイトル}

## 印象に残った箇所

> 引用文をここに

メモ・考察。

## 自分の考え

## 関連する他の本
```

`book.html` は marked.js で Markdown → HTML レンダリングする。見出し / 引用 / リスト / 強調 / リンク / コードブロックなど通常の Markdown 記法が使える。
