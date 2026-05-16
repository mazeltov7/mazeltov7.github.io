#!/usr/bin/env python3
"""Cloudflare Web Analytics → Telegram 通知。

サブコマンド:
  weekly   過去7日のサマリーを Telegram に送る (土曜朝の cron 用)
  anomaly  直近1日の指標を過去4週同曜日と比較し、しきい値超なら通知 (毎日朝 cron 用)

必要な環境変数:
  CLOUDFLARE_API_TOKEN   Account Analytics: Read 権限
  CLOUDFLARE_ACCOUNT_ID  Cloudflare account ID
  CLOUDFLARE_SITE_TAG    Web Analytics の site tag (data-cf-beacon の token と同一)
  TELEGRAM_BOT_TOKEN     Telegram bot token
  TELEGRAM_CHAT_ID       通知先 chat id
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql"
TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"

JST = timezone(timedelta(hours=9))


def env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.exit(f"missing env: {name}")
    return v


def cf_graphql(query: str, variables: dict) -> dict:
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        GRAPHQL_ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Bearer {env('CLOUDFLARE_API_TOKEN')}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read())
    if payload.get("errors"):
        raise RuntimeError(f"GraphQL errors: {payload['errors']}")
    return payload["data"]


def telegram_send(text: str) -> None:
    body = json.dumps(
        {
            "chat_id": env("TELEGRAM_CHAT_ID"),
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
    ).encode()
    req = urllib.request.Request(
        TELEGRAM_API.format(token=env("TELEGRAM_BOT_TOKEN")),
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"telegram error: {e.read().decode()}")


# ---------- weekly ----------

WEEKLY_QUERY = """
query Weekly($accountTag: string!, $siteTag: string!, $since: Date!, $until: Date!) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      total: rumPageloadEventsAdaptiveGroups(
        limit: 1
        filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}
      ) {
        count
        sum { visits }
      }
      daily: rumPageloadEventsAdaptiveGroups(
        limit: 100
        filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}
        orderBy: [date_ASC]
      ) {
        count
        sum { visits }
        dimensions { date }
      }
      paths: rumPageloadEventsAdaptiveGroups(
        limit: 15
        filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { metric: requestPath }
      }
      referers: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}
        orderBy: [count_DESC]
      ) {
        count
        dimensions { metric: refererHost }
      }
      countries: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}
        orderBy: [count_DESC]
      ) {
        count
        dimensions { metric: countryName }
      }
      devices: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}
        orderBy: [count_DESC]
      ) {
        count
        dimensions { metric: deviceType }
      }
      browsers: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}
        orderBy: [count_DESC]
      ) {
        count
        dimensions { metric: userAgentBrowser }
      }
    }
  }
}
"""


def cmd_weekly() -> None:
    today_utc = datetime.now(timezone.utc).date()
    until = today_utc - timedelta(days=1)
    since = until - timedelta(days=6)
    prev_until = since - timedelta(days=1)
    prev_since = prev_until - timedelta(days=6)

    common = {
        "accountTag": env("CLOUDFLARE_ACCOUNT_ID"),
        "siteTag": env("CLOUDFLARE_SITE_TAG"),
    }

    current = cf_graphql(
        WEEKLY_QUERY,
        {**common, "since": since.isoformat(), "until": until.isoformat()},
    )["viewer"]["accounts"][0]

    prev = cf_graphql(
        WEEKLY_QUERY,
        {**common, "since": prev_since.isoformat(), "until": prev_until.isoformat()},
    )["viewer"]["accounts"][0]

    def total_pv(block) -> int:
        return block["total"][0]["count"] if block["total"] else 0

    def total_visits(block) -> int:
        return block["total"][0]["sum"]["visits"] if block["total"] else 0

    pv = total_pv(current)
    visits = total_visits(current)
    pv_prev = total_pv(prev)
    visits_prev = total_visits(prev)

    def delta(now: int, before: int) -> str:
        if before == 0:
            return "(前週 0)"
        diff = now - before
        pct = diff / before * 100
        sign = "+" if diff >= 0 else ""
        return f"({sign}{diff} / {sign}{pct:.0f}%)"

    def fmt_top(rows, label: str, limit: int = 10) -> str:
        if not rows:
            return f"<b>{label}</b>: (なし)"
        lines = [f"<b>{label}</b>"]
        for r in rows[:limit]:
            metric = r["dimensions"]["metric"] or "(空)"
            lines.append(f"  {r['count']:>5}  {metric}")
        return "\n".join(lines)

    daily_lines = []
    for d in current["daily"]:
        daily_lines.append(f"  {d['dimensions']['date']}  PV {d['count']:>5}")

    msg = (
        f"<b>📊 mazeltov7.com 週次レポート</b>\n"
        f"期間: {since} 〜 {until} (UTC)\n\n"
        f"<b>合計</b>\n"
        f"  PV     : {pv:>6}  {delta(pv, pv_prev)}\n"
        f"  Visits : {visits:>6}  {delta(visits, visits_prev)}\n\n"
        f"<b>日別 PV</b>\n" + "\n".join(daily_lines) + "\n\n"
        + fmt_top(current["paths"], "上位ページ (PV)", 15) + "\n\n"
        + fmt_top(current["referers"], "上位リファラ") + "\n\n"
        + fmt_top(current["countries"], "上位国") + "\n\n"
        + fmt_top(current["devices"], "デバイス") + "\n\n"
        + fmt_top(current["browsers"], "ブラウザ")
    )
    telegram_send(msg)
    print("weekly sent.")


# ---------- anomaly ----------

ANOMALY_QUERY = """
query Anomaly($accountTag: string!, $siteTag: string!, $since: Date!, $until: Date!) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      window: rumPageloadEventsAdaptiveGroups(
        limit: 1
        filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}
      ) {
        count
        sum { visits }
      }
      paths: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}
        orderBy: [count_DESC]
      ) {
        count
        dimensions { metric: requestPath }
      }
    }
  }
}
"""

SPIKE_RATIO = 3.0      # 中央値の何倍超で急増判定
DROP_RATIO = 0.3       # 中央値の何倍未満で急減判定
SPIKE_FLOOR_PV = 30    # 急増判定は当日 PV >= この値の場合のみ (ノイズ抑制)
DROP_FLOOR_PV = 30     # 急減判定は基準中央値 >= この値の場合のみ
BASELINE_WEEKS = 4     # 過去N週分の同曜日を比較


def fetch_day(date_str: str) -> dict:
    common = {
        "accountTag": env("CLOUDFLARE_ACCOUNT_ID"),
        "siteTag": env("CLOUDFLARE_SITE_TAG"),
    }
    data = cf_graphql(
        ANOMALY_QUERY,
        {**common, "since": date_str, "until": date_str},
    )["viewer"]["accounts"][0]
    return data


def cmd_anomaly() -> None:
    target = (datetime.now(timezone.utc) - timedelta(days=1)).date()

    current = fetch_day(target.isoformat())
    pv_now = current["window"][0]["count"] if current["window"] else 0
    visits_now = current["window"][0]["sum"]["visits"] if current["window"] else 0

    baseline_pv = []
    baseline_visits = []
    for w in range(1, BASELINE_WEEKS + 1):
        d = fetch_day((target - timedelta(weeks=w)).isoformat())
        if d["window"]:
            baseline_pv.append(d["window"][0]["count"])
            baseline_visits.append(d["window"][0]["sum"]["visits"])

    if not baseline_pv:
        print("no baseline yet; skipping.")
        return

    med_pv = statistics.median(baseline_pv)
    med_visits = statistics.median(baseline_visits)

    alerts = []
    if pv_now >= SPIKE_FLOOR_PV and med_pv > 0 and pv_now > med_pv * SPIKE_RATIO:
        alerts.append(
            f"🚀 <b>PV 急増</b>: 当日 {pv_now} (基準中央値 {med_pv:.0f}, ×{pv_now / med_pv:.1f})"
        )
    if med_pv >= DROP_FLOOR_PV and pv_now < med_pv * DROP_RATIO:
        alerts.append(
            f"📉 <b>PV 急減</b>: 当日 {pv_now} (基準中央値 {med_pv:.0f}, ×{pv_now / med_pv:.2f})"
        )

    if not alerts:
        print(f"no anomaly. pv_now={pv_now} median={med_pv}")
        return

    path_lines = [
        f"  {r['count']:>4}  {r['dimensions']['metric'] or '(空)'}"
        for r in current["paths"][:5]
    ]
    weekday = ["月", "火", "水", "木", "金", "土", "日"][target.weekday()]

    msg = (
        f"<b>⚠️ mazeltov7.com 異常検知</b>\n"
        f"対象日: {target} ({weekday}) UTC\n"
        f"基準: 過去{len(baseline_pv)}週同曜日の中央値\n\n"
        + "\n".join(alerts)
        + f"\n  Visits 当日: {visits_now} (基準中央値 {med_visits:.0f})\n\n"
        + "<b>当日 上位ページ</b>\n"
        + ("\n".join(path_lines) if path_lines else "  (なし)")
    )
    telegram_send(msg)
    print(f"alert sent: pv_now={pv_now} median={med_pv}")


def cmd_debug() -> None:
    """site_tag と最近のデータ件数を確認する一時コマンド."""
    account_id = env("CLOUDFLARE_ACCOUNT_ID")
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/rum/site_info/list",
        headers={
            "Authorization": f"Bearer {env('CLOUDFLARE_API_TOKEN')}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        sites = json.loads(resp.read())
    print("=== sites ===")
    for s in sites.get("result", []):
        print(f"  site_tag={s.get('site_tag')}  host={s.get('ruleset', {}).get('zone_name') or s.get('site_token')}  created={s.get('created')}")

    print(f"\n=== current site_tag env = {env('CLOUDFLARE_SITE_TAG')} ===")

    # 直近7日 (bot フィルタなし)
    today = datetime.now(timezone.utc).date()
    since = today - timedelta(days=7)
    q = """
    query($accountTag: string!, $siteTag: string!, $since: Date!, $until: Date!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          all: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until}) { count sum { visits } }
          humans: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 0}) { count sum { visits } }
          bots: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {siteTag: $siteTag, date_geq: $since, date_leq: $until, bot: 1}) { count sum { visits } }
        }
      }
    }
    """
    data = cf_graphql(q, {
        "accountTag": account_id,
        "siteTag": env("CLOUDFLARE_SITE_TAG"),
        "since": since.isoformat(),
        "until": (today - timedelta(days=1)).isoformat(),
    })
    print(f"\n=== last 7d (env site_tag) ===")
    print(json.dumps(data, indent=2))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["weekly", "anomaly", "debug"])
    args = p.parse_args()
    if args.cmd == "weekly":
        cmd_weekly()
    elif args.cmd == "anomaly":
        cmd_anomaly()
    else:
        cmd_debug()


if __name__ == "__main__":
    main()
