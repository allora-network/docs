---
title: Atlas API
description: Reference for the Atlas REST API at forge-data.allora.run — authentication, dataset discovery, row queries with resolutions, bulk download, SSE streaming, and Python access via the Forge Builder Kit.
persona: ML builder
verified_against: live Atlas API at forge-data.allora.run — every example executed 2026-07-30; allora-forge-builder-kit 3.0.0 (main @ 8ef3200)
last_reviewed: 2026-07-30
---

# Atlas API

## Goal

Query the [Atlas data platform](https://docs.allora.network/build/atlas/overview) from the command line and from Python: discover datasets, fetch candles at any resolution, bulk-download history, and stream rows in real time.

## Prerequisites

- An Allora API key — self-serve at the [Allora Developer Portal](https://developer.allora.network) (keys are prefixed `UP-`; the same key works for the [Allora API](https://docs.allora.network/consume/api))
- `curl` for the command-line examples; Python 3.10+ for the [Builder Kit examples](#python-atlasdatamanager)

Export your key once and the examples below work as-is:

```bash
export ALLORA_API_KEY="UP-..."
```

## Base URL and authentication

```
https://forge-data.allora.run/api
```

Every endpoint requires the API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: $ALLORA_API_KEY" "https://forge-data.allora.run/api/datasets/?limit=1"
```

Without the header you get `401 {"error":"Missing API key"}`.

Endpoint paths end with a trailing slash (`/api/datasets/`, `/api/rows/`). List endpoints return Django REST Framework-style envelopes: `{"count": ..., "next": ..., "previous": ..., "results": [...]}`.

## Step 1: acquire the public tag

Datasets are protected by [tags](https://docs.allora.network/build/atlas/overview#tag-based-access). A fresh key holds no tags, so acquire the `public` tag first — one idempotent call:

```bash
curl -X POST "https://forge-data.allora.run/api/tags/acquire/" \
  -H "X-API-Key: $ALLORA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tag_name": "public"}'
```

```json
{"message": "Tag acquired successfully"}
```

Re-running it on a key that already holds the tag returns `409` — safe to ignore. The Atlas web UI and the Builder Kit's `AtlasDataManager` both do this automatically.

## Step 2: find a dataset

`GET /api/datasets/` lists the datasets your key can see. It supports free-text `search` over names and descriptions, plus `limit`/`offset` pagination (the response's `next` field carries the pre-built URL for the following page):

```bash
curl -H "X-API-Key: $ALLORA_API_KEY" \
  "https://forge-data.allora.run/api/datasets/?search=tiingo_btcusd_1min&limit=5"
```

```json
{
  "count": 1,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 3,
      "name": "tiingo_btcusd_1min",
      "description": "Tiingo 1-minute OHLCV data for BTCUSD",
      "metadata": {
        "source": "tiingo",
        "ticker": "btcusd",
        "provider": "forge-data-provider",
        "frequency": "1min"
      },
      "created_at": "2026-01-26T19:17:33.793195Z",
      "updated_at": "2026-01-26T19:17:33.795326Z"
    }
  ]
}
```

If this returns your dataset, your key and tag are working — every other endpoint uses the same auth.

Fetch a single dataset by ID with `GET /api/datasets/{id}/`.

### Metadata search

`GET /api/datasets/search/` filters on any metadata field by exact value:

```bash
curl -H "X-API-Key: $ALLORA_API_KEY" \
  "https://forge-data.allora.run/api/datasets/search/?ticker=btcusd"
```

This returns every dataset whose `metadata.ticker` is `btcusd`.

Pass **one** metadata filter per request. Combining filters (for example `?source=tiingo&ticker=btcusd`) currently returns an error — `"multiple metadata filters are temporarily unsupported"` — a limitation that is planned to be removed. Until then, filter on one field and narrow further client-side.

### Columns

`GET /api/columns/?dataset={id}` lists a dataset's typed columns:

```bash
curl -H "X-API-Key: $ALLORA_API_KEY" \
  "https://forge-data.allora.run/api/columns/?dataset=3"
```

```json
{
  "count": 7,
  "next": null,
  "previous": null,
  "results": [
    {"id": 3, "dataset_id": 3, "name": "open", "dtype": "float", "created_at": "2026-01-26T19:17:33.934814Z"},
    {"id": 4, "dataset_id": 3, "name": "high", "dtype": "float", "created_at": "2026-01-26T19:17:34.006085Z"}
  ]
}
```

*(Response truncated — `tiingo_btcusd_1min` has seven float columns: `open`, `high`, `low`, `close`, `volume`, `volume_notional`, `trades_done`.)*

## Step 3: query rows

`GET /api/rows/` is the core query endpoint:

| Param | Description |
|-------|-------------|
| `dataset` / `dataset_name` | Dataset ID or name — one of the two is required |
| `start` / `end` | Time range bounds, RFC 3339 (`2026-07-30T00:00:00Z`) |
| `resolution` | `raw` (default), `5m`, `1h`, or `1d` — non-raw values query pre-computed OHLCV aggregates |
| `limit` / `offset` | Offset pagination (default limit 250, max 10,000) |
| `after` | Cursor pagination — a timestamp; the response's `next` URL has the following cursor pre-filled |
| `ordering` | `timestamp` ascending, `-timestamp` descending |

Latest raw rows:

```bash
curl -H "X-API-Key: $ALLORA_API_KEY" \
  "https://forge-data.allora.run/api/rows/?dataset_name=tiingo_btcusd_1min&limit=2&ordering=-timestamp"
```

```json
{
  "count": -1,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 910254487,
      "dataset_id": 3,
      "timestamp": "2026-07-30T21:59:00Z",
      "created_at": "2026-07-30T22:00:00.376191Z",
      "values": {
        "open": 64693.15622176585,
        "high": 64693.156307225116,
        "low": 64686.02040244367,
        "close": 64688.67038416061,
        "volume": 0.72766832,
        "volume_notional": 47071.896101475904,
        "trades_done": 134
      }
    }
  ]
}
```

*(Response truncated to the first row.)*

`count` is the total matching rows, with two caveats: on very large datasets the count query can time out and return `count: -1` (the data itself is unaffected), and cursor-paginated responses always report `count: 0`. Treat `next: null` — not `count` — as the end-of-data signal.

### Downsampled resolutions

Add `resolution` to get OHLCV buckets instead of raw points. Buckets carry `open`, `high`, `low`, `close`, `volume`, and `count` (data points per bucket) at the top level:

```bash
curl -H "X-API-Key: $ALLORA_API_KEY" \
  "https://forge-data.allora.run/api/rows/?dataset_name=tiingo_btcusd_1min&resolution=1h&limit=3&ordering=-timestamp"
```

```json
{
  "count": 2145,
  "next": "/api/rows/?dataset_name=tiingo_btcusd_1min&limit=3&offset=3&ordering=-timestamp&resolution=1h",
  "previous": null,
  "results": [
    {
      "dataset_id": 3,
      "timestamp": "2026-07-30T19:00:00Z",
      "open": 64640.87525369247,
      "high": 64844.579994222186,
      "low": 64639.41675187879,
      "close": 64741.70195346407,
      "volume": 589.7614337300001,
      "count": 60
    }
  ]
}
```

*(Response truncated to the first bucket.)*

Each resolution caps the time range of a single request — `raw` 24 hours, `5m` 7 days, `1h` 90 days, `1d` unlimited (see [range limits](https://docs.allora.network/build/atlas/overview#resolutions-and-range-limits)). Omit `start`/`end` and the query defaults to the most recent allowed window; exceed the cap and you get:

```json
{"details": null, "error": "time range exceeds maximum of 24h0m0s for resolution=raw; use a coarser resolution: bad request"}
```

### Cursor pagination

For iterating large ranges, cursor pagination is O(1) per page — pass `after` with the last timestamp you've seen and follow `next` until it is `null`:

```bash
curl -H "X-API-Key: $ALLORA_API_KEY" \
  "https://forge-data.allora.run/api/rows/?dataset_name=tiingo_btcusd_1min&after=2026-07-30T21:55:00Z&limit=2&ordering=timestamp"
```

```json
{
  "count": 0,
  "next": "/api/rows/?after=2026-07-30T21%3A57%3A00Z&dataset_name=tiingo_btcusd_1min&limit=2&ordering=timestamp",
  "previous": null,
  "results": [
    {"timestamp": "2026-07-30T21:56:00Z", "...": "..."},
    {"timestamp": "2026-07-30T21:57:00Z", "...": "..."}
  ]
}
```

*(Row bodies elided for brevity — same shape as the raw rows above.)*

## Bulk download

`GET /api/rows/bulk_download/` streams a whole time range in one response — the efficient path for backfills. It takes the same `dataset`/`dataset_name`, `start`, `end`, and `resolution` params plus `output` (`json`, the default, or `csv`):

```bash
curl -H "X-API-Key: $ALLORA_API_KEY" \
  "https://forge-data.allora.run/api/rows/bulk_download/?dataset_name=tiingo_btcusd_1min&start=2026-07-29T00:00:00Z&end=2026-07-30T00:00:00Z&resolution=1h&output=csv"
```

```csv
timestamp,open,high,low,close,volume,count
2026-07-29T00:00:00Z,63852.09935765776,64111.03020276603,63781.73958167701,63878.08438839432,408.84284353,60
2026-07-29T01:00:00Z,63882.10637273496,63931.58154694832,63600.25928414847,63626.41042882476,318.66601494999986,60
```

*(Output truncated to the first two of 24 hourly buckets.)*

With `output=json` (or omitted) the same query returns a flat JSON array of row objects. For multi-month raw backfills, request the history in chunks (the Builder Kit's `backfill_symbol` does 14-day chunks with retry and split-on-failure for you).

## Recent rows as NDJSON

`GET /api/rows/live/` returns the most recent rows (newest first) as newline-delimited JSON — one flat object per line, convenient for piping into other tools. `limit` defaults to 100 (max 10,000); optional `start`/`end` bound the window:

```bash
curl -H "X-API-Key: $ALLORA_API_KEY" \
  "https://forge-data.allora.run/api/rows/live/?dataset_name=tiingo_btcusd_1min&limit=3"
```

```json
{"close":64688.67038416061,"high":64693.156307225116,"low":64686.02040244367,"open":64693.15622176585,"timestamp":"2026-07-30T21:59:00Z","trades_done":134,"volume":0.72766832,"volume_notional":47071.896101475904}
{"close":64682.63723244969,"high":64685.826365674286,"low":64682.054250911155,"open":64682.66244872556,"timestamp":"2026-07-30T21:58:00Z","trades_done":187,"volume":1.3486775199999999,"volume_notional":87236.0187697199}
{"close":64679.00000395987,"high":64691.12448888278,"low":64646.852832919416,"open":64651.0093708298,"timestamp":"2026-07-30T21:57:00Z","trades_done":366,"volume":2.48801944,"volume_notional":160922.6093696122}
```

## Real-time streaming (SSE)

`GET /api/rows/stream/` holds the connection open as a **Server-Sent Events** stream (`Content-Type: text/event-stream`). It takes `dataset` or `dataset_name`:

```bash
curl -N -H "X-API-Key: $ALLORA_API_KEY" \
  "https://forge-data.allora.run/api/rows/stream/?dataset_name=tiingo_btcusd_1min"
```

```
event: connected
data: {"dataset_id":3,"message":"Connected to real-time stream"}

event: data
data: {"close":64780.30788599765,"high":64783.650443566934,"low":64760.977618071105,"open":64760.980970991615,"timestamp":"2026-07-30T20:20:00Z","trades_done":320,"volume":3.64579031,"volume_notional":236175.41876958683}

event: heartbeat
data: {"timestamp":"2026-07-30T22:06:43Z"}
```

The stream sends, in order:

1. One `connected` event confirming the subscription
2. The most recent 100 rows replayed as `data` events (oldest first), so a fresh consumer starts with context
3. A `data` event for each new row as it is ingested
4. A `heartbeat` event every 30 seconds to keep the connection alive

Use any SSE client (`EventSource` in the browser, `curl -N` in scripts) and reconnect on disconnect.

## Tags and access

Beyond [`POST /api/tags/acquire/`](#step-1-acquire-the-public-tag):

```bash
# List all tags (public ones are self-acquirable)
curl -H "X-API-Key: $ALLORA_API_KEY" "https://forge-data.allora.run/api/tags/"

# List a dataset's tags
curl -H "X-API-Key: $ALLORA_API_KEY" "https://forge-data.allora.run/api/datasets/3/tags/"

# Check what access your key has to a dataset
curl -X POST "https://forge-data.allora.run/api/access/check/" \
  -H "X-API-Key: $ALLORA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dataset_id": 3, "require_write": false}'
```

The access check answers with your effective permissions and which tags granted them:

```json
{"has_access": true, "is_owner": false, "matching_tags": ["public"]}
```

## Python: AtlasDataManager

The [Allora Forge Builder Kit](https://github.com/allora-network/allora-forge-builder-kit) ships `AtlasDataManager`, a high-level client that handles tag acquisition, dataset resolution by ticker, chunked backfills into partitioned Parquet files, and live snapshots. Install it:

```bash
pip install "git+https://github.com/allora-network/allora-forge-builder-kit.git" websocket-client
```

Then, with `ALLORA_API_KEY` exported as above:

```python
import os
from datetime import datetime, timedelta, timezone

from allora_forge_builder_kit import AtlasDataManager

manager = AtlasDataManager(
    api_key=os.environ["ALLORA_API_KEY"],
    interval="5m",
    symbols=["BTC/USD"],
)

# Discover the Tiingo 1-minute datasets you can access
datasets = manager.list_available_datasets(source="tiingo", frequency="1min")
print([ds["name"] for ds in datasets])

# Fetch the most recent hour of 1-minute bars as a DataFrame
df = manager.get_live_1min_data("BTC/USD", hours_back=1)
print(df.tail())

# Backfill a day of history into partitioned Parquet files
start = datetime.now(timezone.utc) - timedelta(days=1)
manager.backfill_symbol("BTC/USD", start=start)
```

On first use the constructor acquires the `public` tag for your key automatically. Tickers like `"BTC/USD"` are resolved to datasets named `tiingo_btcusd_1min`. The methods you'll reach for:

| Method | What it does |
|--------|--------------|
| `list_available_datasets(source, frequency)` | List datasets for a source/frequency (default `tiingo` / `1min`) |
| `search_datasets(query)` | Free-text search across dataset names and descriptions |
| `get_live_1min_data(symbol, hours_back)` | Most recent 1-minute bars as a pandas DataFrame, lag-tolerant |
| `get_live_snapshot(symbols)` | Latest completed bar per symbol at the manager's `interval` |
| `backfill_symbol(symbol, start, end)` | Chunked bulk download into per-day Parquet partitions, with retry and split-on-failure |

`AtlasDataManager` refuses base URLs outside `forge-data.allora.run` to protect your API key from being sent elsewhere, and plugs directly into the Builder Kit's `AlloraMLWorkflow` for feature engineering and model training — see [Forge competitions](https://docs.allora.network/build/forge/competitions) for that path.

## Troubleshoot

- **`401 {"error":"Missing API key"}`** — the key goes in the `X-API-Key` header. Check `echo $ALLORA_API_KEY` prints your key.
- **Dataset not found or missing from listings** — a fresh key sees nothing until it holds a tag. Run [step 1](#step-1-acquire-the-public-tag), then retry.
- **`time range exceeds maximum of ... for resolution=...`** — narrow the `start`/`end` window, pick a coarser resolution, or chunk the range via [bulk download](#bulk-download).
- **`multiple metadata filters are temporarily unsupported`** — `/api/datasets/search/` takes one metadata filter per request; filter further client-side.
- **`count` is `-1` or `0` but rows are returned** — expected: `-1` means the total-count query timed out on a huge dataset, `0` is normal for cursor pagination. Follow `next` until `null`.
- **SSE stream goes quiet** — heartbeats arrive every 30 seconds; if they stop, the connection dropped. Reconnect (you'll get the 100-row replay again, so deduplicate by `timestamp`).
- **`ModuleNotFoundError: No module named 'websocket'` on import** — install `websocket-client` alongside the Builder Kit (it is required by the package's top-level imports).

## Next

- The concepts behind the API: [Atlas overview](https://docs.allora.network/build/atlas/overview)
- Feed the data into a model: [build a price prediction worker](https://docs.allora.network/build/worker/sdk-py)
- Deploy against a live topic: [Forge competitions](https://docs.allora.network/build/forge/competitions)
