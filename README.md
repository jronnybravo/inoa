# brandy

A naming engine. Give it a brief; it discovers, mutates, scores and screens
candidate names, then hands back a ranked shortlist with the reasoning, the
risks, and real availability data attached.

Two front ends over one engine: a web app and a CLI.

## The web app

```bash
npm install
npm run dev            # http://localhost:4321
```

Astro in SSR mode on the Node adapter. It has to be Node — the engine resolves
NS records over `node:dns`, reads the system word list off disk, and caches API
responses to the filesystem, none of which survives a static build or an edge
runtime.

A run streams its progress over server-sent events and takes 10–30 seconds. The
result is a specimen sheet: each name with its syllable split, its eleven
scores as ink-density columns you can interrogate for the reasoning behind each
one, its risks, live domain and handle checks, and links into real trademark
clearance. Runs are reproducible — the URL carries every parameter including
the seed, so a link replays the same sheet.

For production:

```bash
npm run build && npm start
```

Public deployment is assumed, so the app ships with limits: six runs per
fifteen minutes per IP, two concurrent runs per process, and a cap of six
strategies and twelve verified finalists per run. Those exist mostly to be a
good citizen of Datamuse, Wikipedia and the RDAP registries, which every run
calls on the visitor's behalf. The rate limiter is in-memory and therefore
per-process; behind more than one instance it needs a shared store.

There is also a blocking JSON endpoint for scripting:

```bash
curl -s 'http://localhost:4321/api/discover.json?brief=A+calm+family+assistant&philosophies=compounds'
```

## The CLI

Zero runtime dependencies — Node 22.18+ runs the TypeScript directly.

```bash
node discover.ts --brief "A calm, private assistant that organizes a family's shared life" \
  --industry consumer-software --emotion calm,trust,warmth --cycles 4
```

Add `--offline` to skip every network call, `--out report.md` to write the
report to a file, `--json` for the raw result object, and `--strategies` to
choose naming philosophies by name rather than taking the first N.

## What it does

Seven stages, run end to end by [discover.ts](discover.ts):

| Stage | What happens |
|---|---|
| 1. Brand DNA | The brief becomes an explicit posture: emotional targets, concept space, sound targets, syllable range, what is ruled out |
| 2. Language | The curated multilingual lexicon is mined across 13 languages |
| 3. Meaning | Roots, cross-domain concepts, live thesaurus expansion, Wikipedia mining — plus deliberate *lateral* concepts from domains the brief never mentions |
| 4. Generation | Every strategy: compounds, portmanteaus, respellings, prefixes, suffixes, acronyms, pure invention — each gated by phonotactics |
| 5. Mutation | The top 20 are bred into descendants using phonetically motivated operators |
| 6. Evaluation | Eleven scored dimensions, plus vetoes that no average can override |
| 7. Repeat | Each cycle runs a different naming philosophy |

The six philosophies are **classical roots**, **compounds**, **English
metaphor**, **coined**, **mythic** and **minimal**. Each selected one gets its
own full cycle of generation and mutation; all six are selectable from both
front ends. (They are genuinely different searches — compounds and coinage
explore disjoint parts of the space — so choosing a spread matters more than
choosing a count.)

## Layout

```
core/        types, deterministic RNG, cached HTTP, phonology, string metrics
data/        curated corpora: morphemes, concepts, lexicon, known marks, screening list
sources/     dictionary · thesaurus · etymology · translations · wikipedia · concepts
generators/  compounds · mutations · portmanteau · misspellings · acronyms · phonetics
analyzers/   pronounceability · readability · sentiment · uniqueness
validators/  domains · social · trademarks
scorers/     brandability · premium · memorability · overall
discover.ts  the orchestrator and CLI

src/pages/            index.astro and the /api routes (streaming + JSON)
src/components/       Masthead, BriefSlip
src/scripts/run.ts    the client: streams a run, renders the specimen sheet
src/lib/              query-param validation, the eleven dimension explanations
src/styles/lab.css    the design system implementation
src/middleware.ts     rate limiting
PRODUCT.md            durable product truth
DESIGN.md             the visual system (tokens are normative)
```

## How scoring works

Eleven dimensions feed a weighted composite. The heaviest is **memorability**,
and the heaviest input to memorability is *imagery* — how much of a mental
picture the name arrives with. This is deliberate. Brevity, two-beat rhythm and
a vowel-final ending are cheap: every made-up name has them, which is exactly
why most made-up names are forgettable. Imagery is the lever a coinage cannot
fake, and it decays as a root stops being audible in the finished name
(`Lumora` keeps all of *lum-*; three mutations later the connection is a story
for the deck, not a signal the audience receives).

Some things are vetoes rather than deductions:

- a blocking meaning in any screened language caps the score at 12
- letter sequences that occur nowhere in English — "random syllables" — cap it at 58
- a near-identical famous mark caps it at 35

A diversity pass then stops one lucky stem from filling the shortlist with its
own descendants, which is otherwise what a mutation stage produces.

## Availability data

- **Domains** — RDAP, the registries' own protocol, following the bootstrap
  redirect to the authoritative server; DNS as a fallback. `unknown` means no
  authoritative answer, not "probably free".
- **Handles** — GitHub and npm are real APIs and their answers are trustworthy.
  Consumer social platforms block automated probes, so they are opt-in and
  always reported as indicative.
- **App stores** — the hard filter. An App Store or Play Store listing matching a
  name drops it before the shortlist is chosen, because an existing listing owns
  the search result you would be competing for. Apple's iTunes Search API is
  official and authoritative; Google Play has no public API, so that half reads
  the public search page and can return `unknown`. Unknown is never folded into
  clear. Disable with `--allow-app-collisions`.
- **Trademarks** — read this honestly. There is no free, unauthenticated,
  machine-readable register covering the jurisdictions that matter, so the
  default score is an *estimate* from a corpus of well-known marks plus the
  sight/sound/relatedness factors an examiner applies. It is a filter for
  narrowing a hundred candidates to five. It is not a clearance search and it is
  not legal advice — every finalist needs a real search. The report prints
  USPTO/EUIPO/WIPO/UKIPO links for the top three.

  If you have register access, point `BRANDY_TRADEMARK_API` at a URL template
  containing `{name}` (optionally with `BRANDY_TRADEMARK_API_KEY`) and its
  results are used instead, flagged `authoritative`.

## Run history

**Every name a run puts on screen** is remembered in `.brandy/seen.ndjson` and
skipped next time — not just the finalists. Names also appear in the streaming
preview and in each cycle's "Best of" line, and recording only the finalists
meant a name you had already seen was free to come back later. The recording
happens at the point of display, so the two cannot drift apart again.

The forward-looking "next mutations" list is deliberately *not* recorded:
blacklisting it would guarantee those names could never actually be produced. Varying the seed changes which material a run draws but cannot know what
earlier runs produced, so without this a strong candidate resurfaces every time
and a second run of the same brief spends its shortlist on names you already
rejected.

Matching is by **exact name**. Near-variants are deliberately not treated as the
same thing: `Kizunyo` and `Kizuneo` sound alike but they are different names,
and excluding one because the other appeared would throw away a candidate you
never actually saw. Resemblance is still handled *within* a single shortlist,
where two variants side by side read as padding — across runs they are simply
two different names. Five runs of an identical brief and seed return 25 names
with no repeats.

- `--repeat` allows previously shown names back in
- `--no-history` runs without recording
- `--forget` erases the history
- `BRANDY_HISTORY` moves the file

Once the history covers most of what a brief can produce, repeats are allowed
again rather than returning a short sheet, and the report says so.

**The history is per-installation, so the web app only uses it for local
callers.** On a public deployment it would be shared between strangers and would
progressively starve everyone's results.

## Extending it

Most of the quality lives in the curated data, not the code:

- [data/concepts.ts](data/concepts.ts) — cross-domain concepts. Adding a domain
  you know well is the highest-yield change you can make.
- [data/tag-vocabulary.ts](data/tag-vocabulary.ts) — the bridge from an arbitrary
  brief to the engine's 167 concept tags, generated once from Datamuse and
  committed. Regenerate with `node scripts/build-tag-index.ts` after adding tags
  to any bank. Without it, only briefs whose words appear in the hand-written
  keyword map produced brief-specific results; everything else drew the same
  generic material.
- [data/compounds.ts](data/compounds.ts) — short concrete English words for
  transparent compounds. Every entry is monosyllabic on purpose: two words of
  two syllables each can never make a name, so the bank enforces the constraint
  rather than leaving it to the filter. Entries carry a role, because 'Ironforge'
  works and 'Forgeiron' does not.
- [data/morphemes.ts](data/morphemes.ts) — combining forms and brand endings.
- [data/lexicon.ts](data/lexicon.ts) — the multilingual bank. Entries are
  hand-vetted for beauty and pronounceability; machine translation is
  deliberately not used, because it returns the correct word rather than the
  beautiful one.
- [data/brands.ts](data/brands.ts) — known marks and cliché patterns.
- [data/negatives.ts](data/negatives.ts) — cross-linguistic screening.

Runs are deterministic: the same `--seed` reproduces the same report. Network
responses are cached under `.cache/`, so re-runs are fast and public APIs are
only hit once.

```bash
npm run typecheck
```

## Caveats

- Phonology is grapheme-level, not IPA. That is a deliberate trade (a name is
  experienced as letters first), but it means edge cases in vowel quality are
  approximated.
- The known-mark corpus is a few hundred entries, weighted toward marks a
  journalist would recognize. It will not catch a collision with a small
  registered mark in your specific class.
- Emotional-fit scoring rests on sound symbolism, which is a real effect but a
  statistical one. Treat a 10-point gap as noise and a 30-point gap as signal.
