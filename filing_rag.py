"""Index SEC filing text in Snowflake and retrieve excerpts for Codex."""
import argparse
import json
import os
import re
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from ingest import ROOT, snowflake_connection

SKIP = {"head", "script", "style", "ix:header", "ix:hidden"}
STOP = set("a an and are as at about be by did do does for from had has have how in is it me of on or that the their this to was were what when where which who why will with".split())


class FilingParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.excluded = []
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.excluded.append(tag)
        if not self.excluded and tag in {"div", "p", "br", "li", "td", "th", "tr"}:
            self.text.append(" ")

    def handle_endtag(self, tag):
        if self.excluded and self.excluded[-1] == tag:
            self.excluded.pop()
        if not self.excluded and tag in {"div", "p", "li", "td", "th", "tr"}:
            self.text.append(" ")

    def handle_data(self, data):
        if not self.excluded:
            self.text.append(data)


def chunks(html):
    parser = FilingParser()
    parser.feed(html)
    words = "".join(parser.text).split()
    for start in range(0, len(words), 170):
        yield " ".join(words[start:start + 210])
        if start + 210 >= len(words):
            break


def filing_record(ticker, accession):
    snapshot = json.loads((ROOT / "site" / "replay-data.json").read_text())
    for company in snapshot["companies"]:
        if company["ticker"] == ticker:
            for filing in company["events"]:
                if filing["accession"] == accession:
                    return filing
    raise ValueError("Filing not found in the replay snapshot for this ticker.")


def download(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "www.sec.gov" or not parsed.path.startswith("/Archives/edgar/data/"):
        raise ValueError("Expected an SEC Archives filing URL.")
    request = Request(url, headers={"User-Agent": os.environ["SEC_USER_AGENT"]})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def index_filing(cursor, args):
    filing = filing_record(args.ticker, args.accession)
    text = args.file.read_text(errors="replace") if args.file else download(filing["url"])
    passages = list(chunks(text))
    if not passages:
        raise ValueError("The filing contains no indexable text.")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS RAG_FILING_CHUNKS (
            TICKER VARCHAR NOT NULL, ACCESSION VARCHAR NOT NULL, CHUNK_ID INTEGER NOT NULL,
            FILED DATE NOT NULL, SOURCE_URL VARCHAR NOT NULL, EXCERPT VARCHAR NOT NULL
        )
    """)
    cursor.execute("BEGIN")
    try:
        cursor.execute("DELETE FROM RAG_FILING_CHUNKS WHERE TICKER = %s AND ACCESSION = %s",
                       (args.ticker, args.accession))
        cursor.executemany("INSERT INTO RAG_FILING_CHUNKS VALUES (%s, %s, %s, %s, %s, %s)", [
            (args.ticker, args.accession, index, filing["date"], filing["url"], passage)
            for index, passage in enumerate(passages)
        ])
        cursor.execute("COMMIT")
    except Exception:
        cursor.execute("ROLLBACK")
        raise
    print(f"Indexed {len(passages)} passages for {args.ticker} from {filing['date']}.")


def search(cursor, args):
    terms = list(dict.fromkeys(word for word in re.findall(r"[a-z0-9]+", args.question.lower())
                               if len(word) >= 3 and word not in STOP))[:12]
    if not terms:
        raise ValueError("Use at least one specific keyword.")
    score_sql = " + ".join("IFF(POSITION(%s, LOWER(EXCERPT)) > 0, 1, 0)" for _ in terms)
    cursor.execute(f"""
        SELECT TICKER, ACCESSION, CHUNK_ID, FILED, SOURCE_URL, EXCERPT,
               {score_sql} AS MATCHED_TERMS
        FROM RAG_FILING_CHUNKS
        WHERE TICKER = %s AND FILED <= TO_DATE(%s)
        QUALIFY ROW_NUMBER() OVER (ORDER BY MATCHED_TERMS DESC, FILED DESC, ACCESSION, CHUNK_ID) <= 5
            AND MATCHED_TERMS > 0
        ORDER BY MATCHED_TERMS DESC, FILED DESC, ACCESSION, CHUNK_ID
    """, (*terms, args.ticker, args.as_of.isoformat()))
    return [dict(zip(("ticker", "accession", "chunk", "filed", "source", "excerpt", "matched_terms"), row))
            for row in cursor.fetchall()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    index = commands.add_parser("index")
    index.add_argument("--ticker", required=True, type=str.upper)
    index.add_argument("--accession", required=True)
    index.add_argument("--file", type=Path, help="Optional local copy of the SEC document")
    retrieve = commands.add_parser("search")
    retrieve.add_argument("--ticker", required=True, type=str.upper)
    retrieve.add_argument("--as-of", required=True, type=date.fromisoformat,
                          help="Last permissible SEC filing date, inclusive (YYYY-MM-DD)")
    retrieve.add_argument("question")
    args = parser.parse_args()
    with snowflake_connection() as connection, connection.cursor() as cursor:
        if args.command == "index":
            index_filing(cursor, args)
        else:
            print(json.dumps(search(cursor, args), indent=2, default=str))


if __name__ == "__main__":
    main()
