#!/usr/bin/env python3
"""
fetch_prayer_times.py
Fetch JAKIM prayer times (e-solat) and save as CSV.

Examples:
  python fetch_prayer_times.py
  python fetch_prayer_times.py --zone SGR01 --period month --outdir data
  python fetch_prayer_times.py --period duration --start 2025-09-01 --end 2025-09-10 --zone SGR01 --outdir data --out selangor_sep_1_10.csv
"""

import argparse
import csv
import datetime as dt
import os
import sys
import time
from typing import Any, Dict, List

import requests

API_URL = "https://www.e-solat.gov.my/index.php"
API_PATH = "esolatApi/takwimsolat"

DEFAULT_ZONE = "SGR01"  # Selangor (Gombak/Petaling/Sepang/Hulu Langat/Hulu Selangor/Shah Alam)
DEFAULT_PERIOD = "month"  # one of: week | month | year | duration
DEFAULT_OUTDIR = "data"
DEFAULT_TIMEOUT = 30
DEFAULT_RETRIES = 3

WANTED_FIELDS = [
    "date", "hijri", "day",
    "imsak", "fajr", "syuruk", "dhuhr", "asr", "maghrib", "isha"
]

def log(msg: str) -> None:
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[fetch_prayer_times] {now} | {msg}", flush=True)

def build_url() -> str:
    return f"{API_URL}?r={API_PATH}"

def fetch_json(
    period: str,
    zone: str,
    start: str | None = None,
    end: str | None = None,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
) -> Dict[str, Any]:
    """
    Calls the JAKIM e-solat API. For period='duration', POST datestart/dateend.
    Retries transient failures.
    """
    url = build_url()
    session = requests.Session()

    for attempt in range(1, retries + 1):
        try:
            if period == "duration":
                if not start or not end:
                    raise ValueError("For period=duration you must provide --start YYYY-MM-DD and --end YYYY-MM-DD.")
                log(f"API call (duration) attempt {attempt}/{retries} | zone={zone} | {start}..{end}")
                resp = session.post(
                    url,
                    params={"period": period, "zone": zone},
                    data={"datestart": start, "dateend": end},
                    timeout=timeout,
                )
            else:
                log(f"API call attempt {attempt}/{retries} | zone={zone} | period={period}")
                resp = session.get(
                    url,
                    params={"period": period, "zone": zone},
                    timeout=timeout,
                )

            resp.raise_for_status()
            data = resp.json()

            # Some responses include ["OK"] or ["Error: ..."] in 'status'
            status = data.get("status")
            if isinstance(status, list):
                status_msg = " | ".join(status)
                log(f"API status: {status_msg}")
                if any(s.lower().startswith("error") for s in status):
                    raise RuntimeError(status_msg)

            if "prayerTime" not in data or not isinstance(data["prayerTime"], list):
                raise RuntimeError("API response missing 'prayerTime' array.")

            return data

        except (requests.RequestException, ValueError, RuntimeError) as e:
            log(f"Warning: {type(e).__name__}: {e}")
            if attempt < retries:
                sleep_s = 2 * attempt
                log(f"Retrying in {sleep_s}s…")
                time.sleep(sleep_s)
            else:
                raise

def normalize_rows(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Produce stable CSV columns even if the API changes.
    """
    out = []
    for it in items:
        row = {k: it.get(k, "") for k in WANTED_FIELDS}
        out.append(row)
    return out

def default_filename(period: str, zone: str, start: str | None, end: str | None) -> str:
    if period == "duration" and start and end:
        return f"waktusolat_{zone}_{start}_to_{end}.csv"
    ym = dt.date.today().strftime("%Y-%m")
    return f"waktusolat_{zone}_{period}_{ym}.csv"

def validate_dates_if_needed(period: str, start: str | None, end: str | None) -> None:
    if period != "duration":
        return
    for name, val in [("start", start), ("end", end)]:
        if val is None:
            raise ValueError(f"--{name} is required for period=duration")
        try:
            dt.datetime.strptime(val, "%Y-%m-%d")
        except ValueError:
            raise ValueError(f"--{name} must be YYYY-MM-DD (got {val!r})")

def write_csv(rows: List[Dict[str, Any]], outdir: str, filename: str) -> str:
    os.makedirs(outdir, exist_ok=True)
    outpath = os.path.join(outdir, filename)
    log(f"Writing CSV → {outpath}")
    with open(outpath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=WANTED_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    log(f"Done. Rows written: {len(rows)}")
    return outpath

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch JAKIM prayer times and save as CSV.")
    p.add_argument("--zone", default=DEFAULT_ZONE, help=f"JAKIM zone code (default: {DEFAULT_ZONE})")
    p.add_argument("--period", default=DEFAULT_PERIOD, choices=["week", "month", "year", "duration"],
                   help=f"Period to fetch (default: {DEFAULT_PERIOD})")
    p.add_argument("--start", help="Start date YYYY-MM-DD (required for --period duration)")
    p.add_argument("--end", help="End date YYYY-MM-DD (required for --period duration)")
    p.add_argument("--out", help="Output CSV filename (optional)")
    p.add_argument("--outdir", default=DEFAULT_OUTDIR, help=f"Output directory (default: {DEFAULT_OUTDIR})")
    p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"HTTP timeout seconds (default: {DEFAULT_TIMEOUT})")
    p.add_argument("--retries", type=int, default=DEFAULT_RETRIES, help=f"Retry attempts on failure (default: {DEFAULT_RETRIES})")
    return p.parse_args()

def main() -> int:
    args = parse_args()
    log(f"Start | zone={args.zone} | period={args.period}"
        + (f" | start={args.start} end={args.end}" if args.period == "duration" else "")
        + f" | outdir={args.outdir}")

    try:
        validate_dates_if_needed(args.period, args.start, args.end)
    except ValueError as e:
        log(f"Input error: {e}")
        return 2

    try:
        data = fetch_json(
            period=args.period,
            zone=args.zone,
            start=args.start,
            end=args.end,
            timeout=args.timeout,
            retries=args.retries,
        )
    except Exception as e:
        log(f"FAILED to fetch data: {e}")
        return 1

    items = data.get("prayerTime", [])
    if not items:
        log("No 'prayerTime' entries returned. Exiting without writing.")
        return 3

    rows = normalize_rows(items)
    filename = args.out or default_filename(args.period, args.zone, args.start, args.end)

    try:
        write_csv(rows, args.outdir, filename)
    except Exception as e:
        log(f"FAILED to write CSV: {e}")
        return 4

    # Quick summary
    unique_dates = sorted({r.get("date", "") for r in rows if r.get("date")})
    if unique_dates:
        log(f"Date range in file: {unique_dates[0]} → {unique_dates[-1]} (total {len(unique_dates)} days)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
