"""Import EDGAR filing and revenue data into Snowflake and export the dashboard."""

import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
REVENUE_TAGS = (
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
    "Revenues",
)
FORMS = {"10-K", "10-Q", "8-K"}


def fetch(path):
    request = Request(
        f"https://data.sec.gov/{path}",
        headers={"User-Agent": os.environ["SEC_USER_AGENT"], "Accept": "application/json"},
    )
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def filing_url(cik, accession, filename):
    folder = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}"
    return f"{folder}/{filename or accession + '-index.html'}"


def extract(company, submissions, facts, cutoff):
    cik = company["cik"]
    columns = submissions["filings"]["recent"]
    filings = []
    for index, form in enumerate(columns["form"]):
        if form not in FORMS or columns["filingDate"][index] < cutoff:
            continue
        accession = columns["accessionNumber"][index]
        filings.append((cik, accession, form, columns["filingDate"][index],
                        columns["reportDate"][index] or None,
                        filing_url(cik, accession, columns["primaryDocument"][index])))

    gaap = facts["facts"].get("us-gaap", {})
    periods = {}
    for tag in REVENUE_TAGS:
        for fact in gaap.get(tag, {}).get("units", {}).get("USD", ()):
            start = fact.get("start")
            end = fact["end"]
            if not start or fact["form"] not in {"10-K", "10-Q"}:
                continue
            duration = (date.fromisoformat(end) - date.fromisoformat(start)).days
            if not (75 <= duration <= 105 or 350 <= duration <= 380):
                continue
            key = (start, end)
            if key not in periods or fact["filed"] > periods[key]["filed"]:
                periods[key] = fact

    revenue = {}
    for (start, end), fact in periods.items():
        duration = (date.fromisoformat(end) - date.fromisoformat(start)).days
        if 75 <= duration <= 105:
            revenue[end] = (start, fact["val"], fact["accn"], "Reported")
    for (start, end), fact in periods.items():
        if end in revenue or (date.fromisoformat(end) - date.fromisoformat(start)).days < 350:
            continue
        prior = sorted((q_end, *point) for q_end, point in revenue.items()
                       if start <= point[0] <= q_end < end and point[3] == "Reported")
        if len(prior) != 3 or prior[0][1] != start:
            continue
        if any(date.fromisoformat(right[1]) - date.fromisoformat(left[0]) != timedelta(days=1)
               for left, right in zip(prior, prior[1:])):
            continue
        fourth_start = date.fromisoformat(prior[-1][0]) + timedelta(days=1)
        if 75 <= (date.fromisoformat(end) - fourth_start).days <= 105:
            amount = fact["val"] - sum(point[2] for point in prior)
            revenue[end] = (fourth_start.isoformat(), amount, fact["accn"], "Derived Q4")

    rows = []
    for end, (start, amount, accession, basis) in sorted(revenue.items()):
        if end >= cutoff:
            rows.append((cik, end, start, amount, accession, basis,
                         filing_url(cik, accession, None)))
    return filings, rows


TABLES = {
    "COMPANIES": ("CIK VARCHAR, TICKER VARCHAR, NAME VARCHAR", ("CIK",)),
    "FILINGS": ("CIK VARCHAR, ACCESSION VARCHAR, FORM VARCHAR, FILED DATE, PERIOD_END DATE, "
                "SOURCE_URL VARCHAR", ("CIK", "ACCESSION")),
    "QUARTERLY_REVENUE": ("CIK VARCHAR, PERIOD_END DATE, PERIOD_START DATE, REVENUE_USD NUMBER, "
                          "ACCESSION VARCHAR, BASIS VARCHAR, SOURCE_URL VARCHAR",
                          ("CIK", "PERIOD_END")),
}


def load(cursor, table, rows):
    definition, keys = TABLES[table]
    columns = [column.split()[0] for column in definition.split(", ")]
    cursor.execute(f"CREATE TABLE IF NOT EXISTS {table} ({definition})")
    if not rows:
        return
    stage = f"STAGE_{table}"
    cursor.execute(f"CREATE TEMPORARY TABLE {stage} LIKE {table}")
    placeholders = ", ".join(["%s"] * len(columns))
    cursor.executemany(f"INSERT INTO {stage} VALUES ({placeholders})", rows)
    match = " AND ".join(f"target.{key} = source.{key}" for key in keys)
    cursor.execute(f"MERGE INTO {table} AS target USING {stage} AS source ON {match} "
                   "WHEN MATCHED THEN UPDATE ALL BY NAME "
                   "WHEN NOT MATCHED THEN INSERT ALL BY NAME")


def export(cursor, companies, cutoff):
    result = {"refreshedAt": datetime.now(timezone.utc).isoformat(), "companies": []}
    for company in companies:
        params = (company["cik"], cutoff)
        cursor.execute(
            "SELECT FORM, FILED, SOURCE_URL FROM FILINGS WHERE CIK = %s AND FILED >= %s "
            "ORDER BY FILED DESC, ACCESSION DESC", params,
        )
        filings = [{"form": form, "date": str(filed), "url": url}
                   for form, filed, url in cursor.fetchall()]
        cursor.execute(
            "SELECT PERIOD_END, REVENUE_USD, BASIS, SOURCE_URL FROM QUARTERLY_REVENUE "
            "WHERE CIK = %s AND PERIOD_END >= %s ORDER BY PERIOD_END", params,
        )
        revenue = [{"date": str(end), "value": int(value), "basis": basis, "url": url}
                   for end, value, basis, url in cursor.fetchall()]
        result["companies"].append({**company, "filings": filings, "revenue": revenue})
        print(f"{company['ticker']}: {len(filings)} filings, {len(revenue)} revenue points")
    output = ROOT / "site" / "dashboard.json"
    pending = output.with_suffix(".tmp")
    pending.write_text(json.dumps(result, indent=2) + "\n")
    pending.replace(output)


def snowflake_connection():
    import snowflake.connector

    profile = os.environ.get("SNOWFLAKE_CONNECTION_NAME")
    if profile:
        settings = {"connection_name": profile}
    else:
        config = ROOT / ".local" / "snowflake-connection.json"
        if not config.is_file():
            raise SystemExit("Set SNOWFLAKE_CONNECTION_NAME or create .local/snowflake-connection.json.")
        settings = json.loads(config.read_text())
        settings.setdefault("authenticator", "SNOWFLAKE_JWT")
        settings.setdefault("private_key_file", str(ROOT / ".local" / "snowflake-key.p8"))

    return snowflake.connector.connect(**settings)


def main():
    companies = json.loads((ROOT / "companies.json").read_text())
    if any(not re.fullmatch(r"[0-9]{10}", company["cik"]) for company in companies):
        raise ValueError("Company CIKs must be ten-digit strings.")
    cutoff = (date.today() - timedelta(days=730)).isoformat()
    filings, revenue = [], []
    for company in companies:
        cik = company["cik"]
        company_filings, company_revenue = extract(
            company, fetch(f"submissions/CIK{cik}.json"),
            fetch(f"api/xbrl/companyfacts/CIK{cik}.json"), cutoff,
        )
        filings.extend(company_filings)
        revenue.extend(company_revenue)
    with snowflake_connection() as connection:
        with connection.cursor() as cursor:
            load(cursor, "COMPANIES", [(c["cik"], c["ticker"], c["name"]) for c in companies])
            load(cursor, "FILINGS", filings)
            load(cursor, "QUARTERLY_REVENUE", revenue)
            export(cursor, companies, cutoff)


if __name__ == "__main__":
    main()
