# Analytics monitoring

mazeltov7.com の Cloudflare Web Analytics を GitHub Actions で定期取得し、Telegram に通知する。

- **週次レポート**: 土曜 09:00 JST に過去7日のサマリーを送信 (`.github/workflows/cf-analytics-weekly.yml`)
- **異常検知**: 毎日 08:30 JST に「前日 UTC」と「過去4週同曜日の中央値」を比較し、3倍超 / 0.3倍未満で通知 (`.github/workflows/cf-analytics-anomaly.yml`)

スクリプト本体: `scripts/cf_analytics.py`

## 初回セットアップ

GitHub Secrets に以下 5 つを登録する。
`https://github.com/mazeltov7/mazeltov7.github.io/settings/secrets/actions` → New repository secret

| Secret 名 | 値の取り方 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 後述の「CF API Token 発行」 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard 右下 "Account ID" |
| `CLOUDFLARE_SITE_TAG` | `e0c5e914f911409b9ac700d18df8bec4` (GraphQL の siteTag。HTML の `data-cf-beacon` token とは別物なので注意) |
| `TELEGRAM_BOT_TOKEN` | `~/.claude/channels/telegram/access.json` の `botToken` |
| `TELEGRAM_CHAT_ID` | `7627377223` (現状の allowFrom と同じ) |

### CF API Token 発行

1. https://dash.cloudflare.com/profile/api-tokens → "Create Token" → "Create Custom Token"
2. 権限: **Account → Account Analytics → Read** のみ
3. Account Resources: 該当アカウントのみ
4. TTL なしで作成 → 値をコピーして `CLOUDFLARE_API_TOKEN` に登録

## 動作確認

Secrets を登録したら Actions タブから手動実行できる:

- Actions → "CF Analytics Weekly Report" → "Run workflow"
- Actions → "CF Analytics Anomaly Detection" → "Run workflow"

ローカルで叩く場合:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_SITE_TAG=822f6925e2b64a45928c584854ac19a2
export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_CHAT_ID=7627377223
python3 scripts/cf_analytics.py weekly
python3 scripts/cf_analytics.py anomaly
```

## しきい値チューニング

`scripts/cf_analytics.py` 冒頭の定数:

| 定数 | 既定 | 意味 |
|---|---|---|
| `SPIKE_RATIO` | 3.0 | 中央値の何倍超で急増判定 |
| `DROP_RATIO` | 0.3 | 中央値の何倍未満で急減判定 |
| `SPIKE_FLOOR_PV` | 30 | 当日 PV がこの値以上のときだけ急増判定 (ノイズ抑制) |
| `DROP_FLOOR_PV` | 30 | 基準中央値がこの値以上のときだけ急減判定 |
| `BASELINE_WEEKS` | 4 | 過去N週同曜日を比較対象に使う |

通知が多すぎる/少なすぎる場合は数字を調整して push するだけで反映される。
