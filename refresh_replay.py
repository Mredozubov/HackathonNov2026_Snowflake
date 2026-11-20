"""Refresh historical daily closes and selected SEC disclosures for the replay."""
import csv
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from decimal import Decimal
from urllib.request import Request, urlopen

from ingest import ROOT, fetch, filing_url

MARKET = "https://pubmarks.github.io/datasets/stocks"
PILOT = ROOT / "replay_companies.json"
OUTPUT = ROOT / "site" / "replay-data.json"
FORMS = {"10-K": "Annual report filed", "10-Q": "Quarterly report filed"}
ITEMS = {"2.02": "Earnings results disclosed", "4.01": "Auditor change disclosed",
         "4.02": "Prior statements cannot be relied upon", "5.02": "Leadership or board change disclosed"}


def market_prices(ticker):
    url = f"{MARKET}/{ticker}/ohlcv.csv"
    with urlopen(Request(url, headers={"User-Agent": "Historical replay prototype"}), timeout=25) as response:
        rows = csv.DictReader(io.StringIO(response.read().decode("utf-8-sig")))
        prices = {}
        for row in rows:
            session = date.fromisoformat(row["date"]).isoformat()
            close = Decimal(row["close"])
            if session >= "2000-01-01" and close.is_finite() and close > 0:
                prices[session] = float(close)
    if not prices:
        raise ValueError(f"No closes returned for {ticker}")
    return url, sorted(prices.items())


def sec(path):
    time.sleep(.16)
    return fetch(path)


def company_events(cik, start):
    submissions = sec(f"submissions/CIK{cik}.json")["filings"]
    blocks = [submissions["recent"]]
    for archive in submissions["files"]:
        if archive["filingTo"] >= start:
            blocks.append(sec("submissions/" + archive["name"]))
    for block in blocks:
        for index, form in enumerate(block["form"]):
            filed = block["filingDate"][index]
            if filed < start:
                continue
            items = set(block["items"][index].replace(",", " ").split()) if "items" in block else set()
            title = FORMS.get(form)
            if form == "8-K":
                title = next((label for code, label in ITEMS.items() if code in items), None)
            if not title:
                continue
            accession = block["accessionNumber"][index]
            accepted = block.get("acceptanceDateTime", [])[index:index + 1]
            yield {"date": filed, "accepted": accepted[0] if accepted else None, "title": title,
                   "copy": f"{form} filed with the SEC.", "accession": accession,
                   "url": filing_url(cik, accession, block["primaryDocument"][index])}


def main():
    companies = json.loads(PILOT.read_text())
    with ThreadPoolExecutor(max_workers=4) as pool:
        market = list(pool.map(market_prices, (company["ticker"] for company in companies)))
    result = []
    for company, (source, prices) in zip(companies, market):
        ciks = [company["cik"]]
        if company.get("previousCik"):
            ciks.append(company["previousCik"])
        records = {record["accession"]: record for cik in ciks for record in company_events(cik, prices[0][0])}
        events = sorted(records.values(), key=lambda row: (row["date"], row["accession"]))
        result.append({**company, "priceSource": source, "prices": prices, "events": events})
        print(f"{company['ticker']}: {len(prices)} closes through {prices[-1][0]}, {len(events)} disclosures", flush=True)
    pending = OUTPUT.with_suffix(".tmp")
    pending.write_text(json.dumps({"updatedAt": datetime.now(timezone.utc).isoformat(), "companies": result},
                                  separators=(",", ":")) + "\n")
    pending.replace(OUTPUT)


if __name__ == "__main__":
    main()
