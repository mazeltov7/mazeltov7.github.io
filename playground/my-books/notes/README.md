# Notes

各本の個人メモ Markdown を `{KEY}.md` で保存するディレクトリ。**ファイルがなければ詳細ページは「まだメモなし」と表示する**ので、必要な本だけ作ればよい。

## KEY の決め方

- **Amazon ASIN がある本**: `cover` URL の `https://m.media-amazon.com/images/P/{ASIN}.jpg` の `{ASIN}` 部分（10桁の英数字）。例: `4488618030.md`
- **ASIN がない本（Google Books cover など）**: タイトル文字列を `/`, `\`, `?`, `#`, `&`, `%` を `-` に置換したもの。例: `WATCHMEN.md`

## 書き方

決まったテンプレはなし。`# タイトル` から始めて、自由に Markdown で書く。`book.html` は marked.js で Markdown → HTML にレンダリングするので、見出し / 引用 / リスト / 強調 / リンク / コードブロックなど通常の Markdown 記法がそのまま使える。

`/memo {タイトル} "本文"` で追記すると自動でこのディレクトリに反映される。
