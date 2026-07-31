---
title: llms.txt and agent endpoints
description: The machine-readable surfaces of these docs — llms.txt, llms-full.txt, per-page raw markdown under /raw/, and the JSON manifests under /api/.
persona: AI agent developer
verified_against: scripts/generateLlmsTxt.js and scripts/generateRawMarkdown.js in github.com/allora-network/docs (63 pages); public/api/topics.json
last_reviewed: 2026-07-31
---

# llms.txt and agent endpoints

Everything on this site is also published in formats meant for programs rather
than browsers: an index of every page, the full text of every page, the raw
markdown of any single page, and JSON manifests for the facts that change
without anyone editing a page. No API key and no authentication.

If you are an agent working through a task rather than looking up a format,
start at the [agent quickstart](https://docs.allora.network/get-started/quickstart-agents).

## At a glance

| URL | What it is | Fetch it when |
| --- | --- | --- |
| [`/llms.txt`](https://docs.allora.network/llms.txt) | Index of every page: title, URL, one-line description | You need to route a question to the right page |
| [`/llms-full.txt`](https://docs.allora.network/llms-full.txt) | Full text of every page in one file (~440 KB) | You want the whole corpus in one request |
| `/raw/<page-path>.md` | One page as plain markdown | You already know which page you need |
| [`/api/topics.json`](https://docs.allora.network/api/topics.json) | Active topics on each network | You need live topic IDs, epochs, or loss methods |
| `/api/networks.json` | Network endpoints and chain IDs | You need an RPC, LCD, or chain ID |
| `/api/versions.json` | Current published component versions | You need the version to install or pin |

## llms.txt

An [llmstxt.org](https://llmstxt.org) index. After a site summary, every page
appears as a single line:

```
- [Page title](https://docs.allora.network/path): One-line description.
```

Pages are grouped under an H2 per top-level section (Get Started, Build on
Allora, Consume Inference, Operate the Network, Learn, Reference) and listed in
site navigation order — the same order as the sidebar.

```bash
curl -s https://docs.allora.network/llms.txt
```

## llms-full.txt

The complete text of every page, concatenated in the same navigation order.
Each page is introduced by a thematic break, its title as an H1, the canonical
URL it came from, and its description (indented here so this example cannot be
mistaken for a real page boundary — in the file itself these lines start at
column 0):

```
  ---

  # Page title

  Source: https://docs.allora.network/<page path>

  One-line description.

  ...page body as markdown...
```

```bash
curl -s https://docs.allora.network/llms-full.txt
```

To recover per-page boundaries, split on lines matching
`^Source: https://docs.allora.network/` — one per page, in the same order as
`llms.txt`, each preceded by the page's H1. Counting them is a cheap check that
you have the whole file:

```bash
curl -s https://docs.allora.network/llms-full.txt |
  grep -c '^Source: https://docs.allora.network/'
```

Anything indented, or inside a fenced code block, is page content rather than a
delimiter. If you only need one page, fetch its raw file instead.

## Raw markdown for one page

Every page is also published on its own as plain markdown under `/raw/`, served
as `text/markdown; charset=UTF-8`.

### URL convention

Take the page's path, prefix it with `/raw/`, and append `.md`:

| Page | Raw markdown |
| --- | --- |
| `/get-started/quickstart-worker` | `/raw/get-started/quickstart-worker.md` |
| `/build/worker/sdk-py` | `/raw/build/worker/sdk-py.md` |
| `/reference/params/chain` | `/raw/reference/params/chain.md` |
| `/build/reputer` | `/raw/build/reputer.md` |

That rule covers landing pages too: `/build/reputer` is a section landing page
with `/build/reputer/build-a-reputer` and its siblings beneath it, and its raw
file is still `/raw/build/reputer.md`.

The one shape it does not cover is a landing page whose source file is named
`index`, which keeps that name under `/raw/`. Today `/get-started` is the only
one: it is at `/raw/get-started/index.md`, and `/raw/get-started.md` does not
exist. So the complete two-step rule is **append `.md`; on a 404, retry with
`/index.md`**:

```bash
curl -sf https://docs.allora.network/raw/get-started.md ||
  curl -s https://docs.allora.network/raw/get-started/index.md
```

The mapping is total: every page listed in `llms.txt` has exactly one raw file,
and every raw file corresponds to a live page. Files belonging to renamed or
removed pages are pruned at build time, so nothing stale is ever left behind
under `/raw/`.

### What a raw file contains

The page's YAML frontmatter verbatim, followed by the page body reduced to
plain markdown:

```bash
curl -s https://docs.allora.network/raw/get-started/quickstart-agents.md | head -9
```

```
---
title: Agent quickstart
description: An operating guide for AI coding agents — load the machine-readable docs, apply the guardrails, and submit and consume a live testnet inference without human input.
persona: AI coding agent
verified_against: allora-sdk-py (github.com/allora-network/allora-sdk-py) on allora-testnet-1 (emissions/v10); live api.allora.network v2 responses; allora-forge-builder-kit main (2026-07-22)
last_reviewed: 2026-07-30
---

# Agent quickstart
```

The frontmatter keys are the same five every page carries: `title`,
`description`, `persona`, `verified_against` (what the content was checked
against), and `last_reviewed` (`YYYY-MM-DD`).

Four things differ from the page's MDX source, all of them so that the file
stands on its own:

- **Code snippets are inlined.** Many code blocks on the site pull their body
  from a runnable file in the repository, so the fence in the source is empty.
  In the raw markdown the snippet's actual contents are already there, exactly
  as the rendered page shows them.
- **Links are absolute.** Internal links become full
  `https://docs.allora.network/...` URLs, because a detached `.md` file has no
  page to resolve `./sibling` against.
- **Layout components are unwrapped.** Callouts, tabs, and card grids become
  their text content; a component that occupies a line of its own is dropped.
  One left-over: a component used *inline in a sentence* survives as its
  literal tag. Components that render live data are never expanded either — the
  topic tables on [Existing Allora Network Topics](https://docs.allora.network/build/forge/topics), for
  instance, are absent; fetch `/api/topics.json` for that data instead.
- **Version placeholders are resolved.** Prose that interpolates a version
  constant carries the version string itself.

Headings, prose, tables, and code are otherwise the page's own text, in the
page's own order.

## JSON manifests

Three files under `/api/` carry the facts that go stale on their own —
chain state, endpoints, and versions — so you can read them instead of parsing
prose.

### /api/topics.json

Every topic currently **active** on each network. A nightly job queries each
network's Cosmos LCD (REST) API, keeps only topics whose `is_topic_active`
query returns `true`, and proposes the regenerated file for review. It is the
same data the [Existing Allora Network Topics](https://docs.allora.network/build/forge/topics) page
renders.

```bash
curl -s https://docs.allora.network/api/topics.json
```

```json
{
  "generated_at": "2026-07-31T14:57:07Z",
  "source": "Cosmos LCD (REST) emissions API: next_topic_id, is_topic_active, topics",
  "networks": [
    {
      "network": "testnet",
      "chain_id": "allora-testnet-1",
      "emissions_api": "v10",
      "lcd": "https://allora-api.testnet.allora.network",
      "active_topic_count": 39
    }
  ],
  "topics": [
    {
      "network": "testnet",
      "chain_id": "allora-testnet-1",
      "id": 1,
      "metadata": "ETH 10min Prediction",
      "epoch_length": 120,
      "loss_method": "mse",
      "category": "price",
      "sandbox": false
    }
  ]
}
```

`epoch_length` is in blocks, `category` is `price`, `log-return`, or
`volatility`, and `sandbox` marks the no-penalty onboarding topics. Topic IDs
are per chain: the same prediction task has different IDs on testnet and
mainnet.

The `generated_at` field says when the published copy was built — read it
rather than assuming a cadence, and confirm a topic against the chain before
building against it:

```bash
curl -s https://allora-api.testnet.allora.network/emissions/v10/is_topic_active/69
```

### /api/networks.json

The network endpoints manifest: endpoints and chain IDs for each Allora
network, in machine-readable form. [Networks](https://docs.allora.network/reference/networks) is the prose
reference on the same subject.

```bash
curl -s https://docs.allora.network/api/networks.json
```

### /api/versions.json

The currently published versions of the Allora components the docs reference,
so an agent can pin an install without scraping prose.

```bash
curl -s https://docs.allora.network/api/versions.json
```

## How these files stay current

`llms.txt`, `llms-full.txt`, and everything under `/raw/` are generated from
the page sources on every build of the site and committed to
[the docs repository](https://github.com/allora-network/docs); continuous
integration fails a pull request whose generated files no longer match its
pages. They therefore ship with the page edit that caused them, never behind
it.

The manifests under `/api/` are not tied to the page build. They are maintained
by scheduled checks against their upstream source that propose an update when
it changes, so a manifest is as current as the last proposal that was accepted
— which is why `topics.json` publishes its own `generated_at`. Read the
freshness metadata a manifest carries rather than assuming a cadence, and for
anything you are about to spend gas on, confirm it against the chain.

## Related

- [Agent quickstart](https://docs.allora.network/get-started/quickstart-agents) — guardrails and a
  runnable end-to-end task for AI coding agents.
- [Networks](https://docs.allora.network/reference/networks) — chain IDs, RPC, LCD, and explorer
  endpoints in prose.
- [Existing Allora Network Topics](https://docs.allora.network/build/forge/topics) — the topic tables
  rendered from `/api/topics.json`.
