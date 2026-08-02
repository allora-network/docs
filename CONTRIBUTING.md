Any contribution that you make to this repository will
be under the Apache 2 License, as dictated by that
[license](http://www.apache.org/licenses/LICENSE-2.0.html):

~~~
5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.
~~~

Contributors must sign-off each commit by adding a `Signed-off-by: ...`
line to commit messages to certify that they have the right to submit
the code they are contributing to the project according to the
[Developer Certificate of Origin (DCO)](https://developercertificate.org/).

# Contributing to the docs site

The documentation site ([docs.allora.network](https://docs.allora.network)) is
built from this repository with [Nextra](https://nextra.site). To propose a
change:

1. Fork the repository and create a branch.
2. Install dependencies with `yarn install` (NodeJS `v20.12.2`), then run
   `yarn dev` and preview your changes at http://localhost:3000.
3. Edit or add MDX pages under `pages/`. When adding, renaming, or removing a
   page, update the sibling `_meta.json` so the sidebar stays in sync.
4. Run `yarn build` and `yarn fixlinks` — both must pass before you open a
   pull request. `yarn fixlinks` validates and rewrites relative links across
   the site.
5. Open a pull request, signing off each commit as described above.

# Page template & PR checklist

Docs pages live under `pages/**` as MDX files ([Nextra](https://nextra.site)
v2, file-system routing). Sidebar order and titles come from the `_meta.json`
in each directory — update it whenever you add, move, or remove a page.

## Frontmatter

Every page starts with a frontmatter block carrying these five keys (CI
enforces this on every pull request):

```mdx
---
title: <page title>
description: <one-line description>
persona: <primary reader, e.g. ML builder>
verified_against: <source + version the content was checked against>
last_reviewed: <YYYY-MM-DD>
---
```

Conventions:

- `title` — matches the page's `#` heading.
- `description` — one sentence; used for search and link previews.
- `persona` — the primary reader, e.g. `ML builder`, `App developer`,
  `Topic creator`, `Validator operator`, `Reputer operator`.
- `verified_against` — the concrete source and version the content was checked
  against, e.g. `allora_sdk 1.0.6 (latest release on PyPI)` or
  `allora-chain v0.17.0`. If a page has not been verified against an external
  source, use `docs content as of YYYY-MM-DD`.
- `last_reviewed` — the date the content was last actually reviewed for
  correctness. Only bump it when you have re-verified the page; cosmetic or
  mechanical edits (typo fixes, link rewrites, file moves) do not count.

The `verified_against` and `last_reviewed` values are metadata only — they do
not render on the page, but they are required and CI-enforced so reviewers and
tooling can tell how fresh each page is.

`yarn checkfm` validates the frontmatter across all pages; it also runs as
part of `yarn build` and in CI. `yarn frontmatter` fills in missing keys with
derived defaults — always review what it generated before committing.

## Generated files: llms.txt, llms-full.txt, and raw markdown

`public/llms.txt` and `public/llms-full.txt` are the machine-readable bundle AI
agents fetch: an [llmstxt.org](https://llmstxt.org) index of every page with its
title and description, and the full text of every page concatenated in
navigation order. Both are generated from `pages/**` by
`scripts/generateLlmsTxt.js`, which runs as part of `yarn build`, and both are
committed because `public/` is served as-is.

`public/raw/**.md` is the same idea one page at a time: every page published on
its own as plain markdown, so an agent can fetch a single page instead of the
whole bundle. It is generated from `pages/**` by
`scripts/generateRawMarkdown.js` — also part of `yarn build`, also committed —
and it mirrors the `pages/` tree with the extension swapped to `.md`. The
directory is generated in full, so renaming or removing a page prunes its stale
raw file automatically.

So whenever you add, remove, rename, retitle, or edit a page, run `yarn build`
(or `yarn llms` and `yarn raw`) and commit the regenerated files.
`yarn checkllms` and `yarn checkraw` verify the committed files still match
`pages/**` without rewriting them; CI runs the same two checks and fails the
pull request if either has drifted.

## How-to page structure

How-to pages use this section order after the frontmatter and the `#` heading:

```mdx
## Goal
## Prerequisites
## Steps
## Verify
## Troubleshoot
## Next
```

Code snippets must be copy-paste complete: no elisions, no interactive
prompts, and environment-variable placeholders for secrets — never real keys.

## Runnable code snippets

Any complete program a reader is told to save and run lives in `snippets/` as a
real file, and the page embeds it with a `file=` fence rather than a copy:

````mdx
```python file=../../snippets/quickstart_worker.py
```
````

The build inlines the file's contents (`scripts/remarkIncludeCode.js`), so the
page can never drift from the file, and a typo in the path fails `yarn build`
instead of shipping an empty code block. Includes must resolve inside
`snippets/`.

Everything in `snippets/` is executed against testnet each night by
`.github/workflows/snippets-nightly.yml`, which builds a clean toolchain per
language, runs `node scripts/runSnippets.js`, and opens an issue with the
failing snippet and its error when a run fails. New snippets are picked up
automatically; `scripts/snippets.config.json` carries per-snippet settings and is
the only place a snippet can be opted out of execution — with a written reason.

A snippet passes only when it prints the result its page documents (its `expect`
pattern). Exiting 0 is not enough, and for a worker loop neither is staying
alive: the loop catches its own exceptions and prints them, so a worker whose
registration or submission failed would otherwise look perfectly healthy. Every
snippet that runs needs an `expect` — the runner refuses to start without one,
so a new file is a configuration error until someone says what proves it worked.

Credentials go only to the snippets that ask for them. Each snippet's `requires`
list is the whole of what its process can see, and package installation runs
with no credentials at all, so a dependency of a read-only snippet has no
mnemonic in its environment to take.

To run the suite yourself, export `ALLORA_API_KEY` and `ALLORA_WALLET_MNEMONIC`
(a funded testnet wallet) and run `yarn runsnippets`. `yarn runsnippets --list`
prints the plan without running anything.

Fragments, config excerpts, and shell one-liners stay inline — only programs
that are meant to run belong in `snippets/`.
## Version strings

Never type a current version number into a page. Every "the version we are on
right now" string lives in `public/api/versions.json` (published at
[/api/versions.json](https://docs.allora.network/api/versions.json)) and is
rendered by the `Version` component:

```mdx
import { Version } from '../../components/Version'

The testnet runs <Version of="chain-testnet"/>, and the release asset is
named `allorad_<Version of="chain-testnet" bare/>_linux_amd64`.
```

`of` accepts any key in that file (`chain-testnet`, `chain-mainnet`,
`allora-sdk`, `builder-kit`); `bare` drops the leading `v`. Where JSX cannot
render — inside a template literal that builds a copy-paste command — import
the constants from `components/versions.ts`, which read the same file.

`yarn checkversions` fails if a version from `versions.json` is typed by hand
anywhere in `pages/`, `components/` or `snippets/`; it also runs as part of
`yarn build` and in CI. Mentions of *when* something changed ("since v0.17.0",
"introduced in v0.17.0") are historical facts, not current versions — leave
those literal. If the checker flags a historical mention it cannot recognise,
add a `version-literal-ok: <reason>` comment on that line.

A scheduled workflow watches upstream for you. When a version that is genuinely
*published* moves ahead of `versions.json` — a GitHub release or tag, or a PyPI
release — it opens a pull request with that change already made. Anything it
cannot confirm on its own it never writes: which release each network is
running, and versions read from a project's default branch rather than a
release. Those are collected in a tracking issue for a human to verify and
apply by hand.

When you apply a network's release by hand, update `public/api/networks.json`'s
`deployed_version` for that network in the same commit. Both files record the
same fact — [Networks](https://docs.allora.network/reference/networks) takes its
prose from `versions.json` and its table from `networks.json` — and
`yarn checkversions` fails while the two disagree.

## PR checklist

Before opening a pull request:

- [ ] Every added or edited page carries the five frontmatter keys
      (`yarn checkfm` passes).
- [ ] `yarn build` passes.
- [ ] `yarn fixlinks` passes (no broken internal links).
- [ ] No current version is typed by hand; versions come from
      `public/api/versions.json` (`yarn checkversions` passes).
- [ ] `_meta.json` is updated for any added, moved, or removed page.
- [ ] `public/llms.txt`, `public/llms-full.txt`, and `public/raw/**` are
      regenerated and committed (`yarn checkllms` and `yarn checkraw` pass).
- [ ] Any removed or moved URL has a 301 redirect in `next.config.js`
      (`redirects()`).
- [ ] Code snippets run as pasted against the version named in
      `verified_against`.
- [ ] Any complete runnable program lives in `snippets/` and is embedded with a
      `file=` fence (`yarn runsnippets --list` shows it).
- [ ] Commits are signed off (DCO, see above).

# Community & Resources

[Our open-source repos](https://github.com/allora-network) all follow the
[same contribution guidelines](https://github.com/allora-network/allora-chain/blob/main/CONTRIBUTING.md),
including these docs themselves. How-to guides, deployment reports, or
documentation contributions can be submitted directly to the
[docs repository](https://github.com/allora-network/docs/).

- [Discord](https://discord.gg/allora) — speak directly with the core Allora
  developers, coordinate with fellow
  [Developer Advocates](https://www.allora.network/blog/introducing-the-allora-network-community-advocate-program-4258c),
  and learn about the many ways to contribute to Allora.
- [Twitter](https://twitter.com/AlloraNetwork) — new announcements and releases.
- [Research forum](https://research.allora.network) — the latest research and
  ideas from the Allora team, focused on collaborative original research
  discussions.
- [Whitepaper](https://research.assets.allora.network/allora.0x10001.pdf)
- [Docs](https://docs.allora.network/)
- [Allora Points Program](https://app.allora.network/points/overview)
- Videos:
  - [Archetype AI Day: Allora Network Walkthrough w/ CEO Nick Emmons](https://www.youtube.com/watch?v=xcqfTdmpfVE&t=127s)
  - [Workshop – "How to bring AI to your web3 apps with the Allora Edgenet" by Allora Labs](https://www.youtube.com/watch?v=aPCvTVFUynA)
