# SEC Filings Dashboard

The prototype imports SEC EDGAR filing metadata and quarterly revenue into Snowflake. It then exports a static JSON snapshot for the dashboard. The initial company list is in [companies.json](companies.json).

## Hackathon demo

[Play the ten-stock trading replay](https://lighthearted-khapse-5f2590.netlify.app/replay) · [Open the SEC filings dashboard](https://lighthearted-khapse-5f2590.netlify.app/)

The [static site source](site/) is plain HTML, CSS, and JavaScript. The replay uses historical daily closes and links to SEC filings. Your trades use virtual money. The live Netlify demo serves the snapshots uploaded with that deploy.

To run locally, generate both snapshots using the commands below, then run `python3 -m http.server 8000 --directory site` and open [the local replay](http://localhost:8000/replay.html).

## Build the filings snapshot

1. Run `python3 -m venv .venv` and `.venv/bin/pip install -r requirements.txt`.
2. Set `SNOWFLAKE_CONNECTION_NAME` to a Snowflake Python Connector profile with access to a warehouse and permission to create and write tables in the target database and schema. For local key-pair authentication, you can instead put your `account`, `user`, `role`, `warehouse`, `database`, and `schema` in `.local/snowflake-connection.json` and store the registered key at `.local/snowflake-key.p8`.
3. Set `SEC_USER_AGENT` to a project name and contact email, then run `.venv/bin/python ingest.py`.

The loader creates and merges into `COMPANIES`, `FILINGS`, and `QUARTERLY_REVENUE`. It exports the dashboard from those tables to `site/dashboard.json`. The snapshot covers the last 730 days. If a standalone fourth-quarter revenue figure is unavailable, the loader labels the figure derived from full-year revenue minus the first three contiguous quarters.

Private keys, the local setup directory, and generated snapshots are excluded from Git. Only the contents of `site/` are needed for a manual Netlify deploy.

## Trading replay

Open /replay.html on the same local HTTP server. Start with $10,000 in virtual cash. Orders fill at the next available close, with a checkpoint each year. Cashing out closes the position; continuing carries it forward.

### Ten-stock historical pilot

The replay reads a generated `site/replay-data.json` snapshot. The roster is in `replay_companies.json`. Run `.venv/bin/python refresh_replay.py` with `SEC_USER_AGENT` set to the project's identifying contact string. The command fetches daily closes from Pubmarks and selected filing events from current and archived SEC EDGAR submissions. It replaces the snapshot atomically after all ten companies refresh successfully.

The replay defaults to a random stock and date. The picker limits dates to available price history. Prices use the provider's historical share basis, and portfolio quantities use the same basis. Portfolio returns are price-only and exclude dividends and borrowing costs. The refresh timestamp and last available trading close are displayed separately. The generated snapshot is excluded from Git. A local refresh updates that file, and the hosted copy changes on redeploy.

## Ask Codex about a filing

`filing_rag.py` indexes filing text into Snowflake's `RAG_FILING_CHUNKS` table and returns source-linked excerpts. It reuses the dashboard loader's Snowflake connection. Set `SEC_USER_AGENT` as for the loader when downloading directly from EDGAR.

```sh
.venv/bin/python filing_rag.py index --ticker AAPL --accession 0000320193-26-000020
.venv/bin/python filing_rag.py search --ticker AAPL --as-of 2026-07-31 "iPhone and Services net sales growth"
```

The accession must appear in the local replay snapshot. The search ranks passages by keyword matches and excludes filings after the requested date. The date cutoff is inclusive. Use the previous calendar date for questions before a known same-day release. Codex can read the returned excerpts and generate a cited answer. The pilot uses Snowflake SQL retrieval and does not require a Cortex Search service or a separate model API key.
