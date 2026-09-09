# Inoa

Generate brand names from a brief, then screen each one against the places a
name can already be taken: the domains you care about, the App Store, Google
Play, and the web.

![A finished naming run: fifty candidates, each with a verdict per check](docs/screenshot.png)

Every cell is one of five states, and the third is the one that matters:
`free` found nothing, `taken` found somebody, and `unverified` means the check
could not get a trustworthy answer. A tool with only the first two turns every
failed lookup into a free name.

## Shape

Two halves, and the split is deliberate.

**The app** (SvelteKit on Vercel) takes the brief, verifies the email, and
displays results. Every function it runs is a sub-second read or write.

**The worker** (this machine) does everything expensive: generation, then the
checks. It exists because a run takes tens of
minutes against a Vercel function cap near a minute — and because store and
search endpoints block datacentre addresses far more readily than a residential
one, so the checks are simply more reliable from here.

When the worker is not running, runs queue. That is the intended behaviour for
an idea captured away from your desk.

## Running it

### Databases

Any database TypeORM supports. Configure it either way:

```bash
DB_TYPE=mysql            # postgres | mysql | mariadb | sqlite
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=inoa
DB_PASSWORD=secret
DB_DATABASE=inoa
```

```bash
DATABASE_URL=postgresql://user:pass@host/inoa   # or just this
```

SQLite needs only `DB_TYPE=sqlite` and `DB_DATABASE=./inoa.sqlite`. Install
the driver you use: `pg`, `mysql2`, or `better-sqlite3` (the last two are
optional dependencies, so a Postgres deployment does not build SQLite).

Verified on Postgres 16, MySQL 8.4 and SQLite — schema creation, JSON columns,
generated uuid keys, the claim query, and two workers racing for one run.

Entities are ActiveRecord style, so they carry their own queries:

```ts
const run = await Run.create({ brief, email }).save();
const waiting = await Run.find({ where: { status: 'queued' } });
await Candidate.update(id, { com: 'clear' });
```

Nothing is written in a dialect. Column types that differ — JSON, timestamps,
uuid keys, and short strings that carry a default — resolve from the connection
string in `src/lib/server/dialect.ts`. Date arithmetic happens in JavaScript
rather than SQL, and the worker claims a run optimistically rather than with
`FOR UPDATE SKIP LOCKED`, which SQLite does not have.

```bash
cp .env.example .env      # fill in DATABASE_URL at minimum
npm run db:sync           # create the tables
npm run dev               # the app
npm run worker            # in a second terminal, on your machine
```

To try it without Neon, any local Postgres will do:

```bash
docker run -d --name inoa-pg -e POSTGRES_PASSWORD=inoa -e POSTGRES_DB=inoa -p 55432:5432 postgres:16-alpine
```

then set `DATABASE_URL=postgresql://postgres:inoa@localhost:55432/inoa`.

The worker needs a signed-in CLI: `claude login`.

That is the default and it costs nothing beyond the subscription. If you have
no Claude subscription, or you want generation to survive a usage limit rather
than stop at one, set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` instead. Sources
are tried in order, CLI first, and `INOA_GENERATOR` reorders them.

**Restart the worker after changing its code or `.env`.** Node does not reload
a running process, so a worker started before a change keeps the old behaviour
while the repository shows the new one — which looks exactly like a bug in the
new code, and is the single most common way to waste an hour on this project.

While developing, `npm run worker:dev` restarts it on every file change. It is
not the right thing in production: a restart mid-run abandons that run, and it
is only reclaimed once its lease expires.

## Contributing

```bash
npm test          # node:test, no test framework to install
npm run lint      # eslint + prettier --check
npm run format    # prettier --write
npm run check     # svelte-check, which also typechecks the worker
```

Tests run on Node's own runner through the same type stripping the worker uses,
so there is no framework and no config. They cover the decisions rather than the
network calls that feed them — what a response establishes, what counts as the
same brand, which tier may answer, and what the queue does when an engine stops
answering. Everything a check depends on from outside is passed in: the funnel
takes a prior-verdict lookup, the queue takes its candidate store and its check.
So the whole suite runs in about a third of a second without asking anyone's
server anything, and the failure cases that matter most — a blocked engine, an
abandoned run — can be provoked on demand instead of waited for.

Four-space indent, single quotes, 100 columns — all enforced by Prettier, so
none of it is worth arguing about in review.

The ESLint config is the project's own, not a published style guide. Two
goals: **strict**, meaning every rule catches a defect rather than a
preference, with type-aware checking on because most defects worth catching
are invisible without types; and **stable**, meaning Prettier owns every
question of layout so the two cannot disagree, and rule sets are named rather
than spread from `all` so a dependency bump cannot introduce a rule nobody
chose. Build output is excluded from both.

Braces on every branch, including single statements. Stricter than most
guides allow, because the compact form reads fine right up until somebody
adds a second statement and it quietly falls outside the branch.

Comments explain _why_, not what. Most of the surprising code here exists
because something failed in a specific way, and the comment is where that
reason is recorded — see `worker/checks/web.ts` for the clearest example.

## Where names come from

**A signed-in CLI first.** `claude login` once and you are done; a Codex CLI on
your PATH is used the same way. Several rotate — a batch each, turn by turn —
which spreads the rate limits and, more usefully, widens the shortlist: a
thousand names from one model is a thousand names with one model's taste in
them, and taste is most of what a naming run is buying.

That order is measured rather than assumed. A batch of fifty names takes
**~108s** through the CLI, of which the process spawn and auth check are
**5.5s** — five per cent, against a cost difference of everything versus
nothing. Both reach the same model family for what is a single-turn prompt.

**API keys as failover.** A subscription that hits its usage limit used to end
generation dead; with `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set it moves to
the key instead. Batches are shared only within the leading tier, so a working
subscription is never quietly billed against a key sitting beside it.
`INOA_GENERATOR` asks for both together when that is what you want.

### Without a model

Set `INOA_AI=off`, or configure nothing at all, and names are composed here
instead — from the brief's own vocabulary, a free thesaurus, and a bundled word
list. No key, no subscription, no cost, and the brief never leaves the
building.

Each of the six approaches has a rule. Compounds and blends draw on words
related to the brief; invented names are assembled from onsets, vowels and
codas that a reader can say on sight; the metaphor and foreign approaches draw
on bundled lists, and every foreign root carries its gloss, because a name you
cannot translate is a name you cannot explain.

It is seeded rather than random, so the same brief produces the same names and
a bad one can be found twice. It is **not** a fallback for a model that failed
mid-run: a source that quietly changes what it is halfway through leaves half a
table from one thing and half from another, with nothing recording which.

### Social handles

Thirteen platforms, defaulting to **Instagram, Facebook and TikTok**. Each was
probed both ways — a handle somebody holds and a handle nobody could — before
being added, and they answer in four different ways:

| how it answers                     | platforms                                                         |
| ---------------------------------- | ----------------------------------------------------------------- |
| status code — the profile URL 404s | X, GitHub, YouTube, Substack, SoundCloud, Vimeo                   |
| public API                         | Bluesky (AT Protocol identity), TikTok (oEmbed), Twitch (GraphQL) |
| link preview                       | Instagram, Facebook — as the crawler that renders previews        |
| page marker                        | Telegram (`View`/`Launch` vs `Contact`), Pinterest (empty title)  |

The list was three long when it only knew the first of those, and the three it
was missing were the three that matter most. None of Instagram, Facebook or
TikTok answers a plain request — a login wall, a redirect, and a 1.4KB bot wall
respectively — but all three still publish a link preview, because they want
their own links to look right in everybody else's app. **A link preview for a
profile that does not exist is exactly the signal being looked for.** Instagram
titles a real profile `NASA (@nasa) • Instagram photos…` and a free handle just
`Instagram`; Facebook does the same with the page name.

Weaker signals are read strictly. A page that matches no recognised shape comes
back `unverified`, and an unrecognised one reads as `taken` rather than `free` —
a wrong `taken` costs a good name, a wrong `free` ships a brand somebody else
owns.

Still out, and now genuinely rather than for want of trying: Reddit is `403`
without a token on both `www` and `old`, Medium sits behind a Cloudflare
interstitial, LinkedIn blocks outright.

Unlike a domain, every handle check reaches the same host, so each platform
gets its own rate limiter (`INOA_HANDLE_INTERVAL_MS`, default 1200ms).

## Runs

`/runs` lists every run this database holds, newest first — brief, status,
names found, how many passed, and how long it took. A run's id used to be its
only handle: an hour of work reachable through one link in one email, and gone
the moment that link was.

Everything is visible to everyone, which is the rule the run pages already
follow — anybody holding a link can open one. There is no account to scope a
list to, and pretending otherwise would be a privacy claim this cannot keep.

## Running without Resend

`RESEND_API_KEY` is optional. Without it the form does not ask for an address
and runs start immediately: there is no way to send a verification code, so
nothing to prove, and nowhere to send results — asking anyway would collect a
detail nothing can use. Results live on the run's page, and `/runs` is how you
find it again.

Set the key and verification comes back: an address proves itself once, results
are emailed when a run finishes, and the CSV is attached.

### The web check without a provider

With no `TAVILY_API_KEY` or equivalent, the web check is not offered. It can
only be answered by driving a browser at about a name a minute — sixteen hours
for a thousand names — so the form leaves it out rather than queueing that
behind your back.

The Web chip stays in the row — a hole where a control was is its own kind of
confusion — but it becomes two states rather than three: a **column of search
links**, or nothing. There is no verdict to report and so nothing that could be
required, and it carries its own mark, a magnifier, rather than borrowing the
one that means "checked and reported".

That column has no filter and never reaches `computePassed` — because the
moment "we did not look" can be counted, it starts counting as "nothing
found".

### Choosing languages

The **Other languages** approach draws on any language by default. Pick a
family (`Nordic`, `Romance`, `Bantu`) or a single language (`Japanese`,
`Tagalog`, `Old Norse`) to narrow it — the picker only appears when that
approach is selected, and an empty selection means any, which is what the
approach meant before it could be narrowed.

Naming the sources matters more than it sounds. Asked for "other languages"
with nothing narrowed, a model reaches for Japanese and Latin almost every
time; a brief that wanted Nordic austerity got `Kizuna` either way. Listed
explicitly, the constraint holds — a live run narrowed to Nordic returned
`Pelto`, `Eldhus`, `Matgard`, `Niitty`, `Groska`, `Kelda`, all of them Finnish,
Old Norse, Swedish or Icelandic.

The constraint reaches the deterministic generator too, which filters its
bundled roots by the same language names — so the `covers` lists in
`src/lib/languages.ts` and the `from` fields in `worker/words.ts` have to
agree. It applies only to that one approach: a compound or invented batch never
draws on those roots, and narrowing them would constrain material they do not
use.

## How a name is judged

Checks run cheapest-first — the domains, then App Store, Play Store, web —
because the expensive ones are the rate-limited ones. Apple tolerates about 20
calls a minute, while a domain costs a DNS lookup and nobody's quota, so every
name a domain gate drops is a name Apple never sees.

A **required** check that returns `taken` drops the name immediately and the
rest are marked skipped. An unrequired check never drops anything; it is
recorded so the table stays complete.

Every check is one of three states, chosen the same way in all three rows of
the form: not checked at all, checked and reported, or required. The App Store
is the slowest thing in a run — Apple tolerates about twenty calls a minute —
so being able to leave it out entirely is worth having.

### Choosing domains

A run picks any number of top-level domains and marks which of them are
required. Everything picked gets a column and a verdict; only the required ones
can end a name.

The list is generated by `node scripts/generate-tlds.mjs` from three sources:
IANA for which TLDs exist, a registrar's public price list for which of those
anybody can actually buy, and the Tranco top million for the order. That leaves
**539 of the 1,438 delegated TLDs**, each with an indicative first-year price.

The registrar is the part that earns its place. Filtering on ICANN's registry
agreements instead — dropping brand TLDs like `.bmw` and keeping the rest —
left 1,059 entries, hundreds of which nobody can register: `.aero` and
`.museum` want credentials, `.bv` and `.sj` were never issued, `.kp` and `.cu`
are unobtainable, and residency-restricted ccTLDs sat near the top because they
are popular rather than available. A price is proof that somebody will sell it
to you.

The cost is coverage: that registrar does not carry `.fr`, `.jp`, `.br` or
`.it`, which are buyable elsewhere, so they are absent. One catalogue of things
you can definitely buy beats a longer list that is part fiction.

There is no cap. There were two — twelve, then twenty-five — and both were
numbers picked rather than measured. A domain check is DNS and one request to a
host nobody else is calling, with no shared quota behind it, while the store
checks are paced against Apple's twenty a minute and dominate the clock
regardless. Nothing needs rationing on anybody else's behalf, so the form shows
the arithmetic — `domains x names` requests, live — and leaves the choice to
whoever is spending the afternoon.

Every cell has three real states, not two:

| state        | meaning                               |
| ------------ | ------------------------------------- |
| `free`       | we looked, and nothing is using it    |
| `taken`      | we looked, and found a collision      |
| `unverified` | we could not get a trustworthy answer |

The third one is not decoration. A boolean cannot tell "it is free" apart from
"we could not find out", and rendering the second as a clean cell is how a
broken check disguises itself as a working one — which is exactly what happened
in the tool this replaces, silently, across 500 names.

The `.com` column is the one worth reading closely, because `free` there is a
claim and this check will not make it without evidence. A domain is cleared
only when something positively says nothing is behind it: it does not resolve,
nothing accepts a connection, the server answers 404, the page says in its own
words that it is for sale, or its nameservers belong to a parking service — a
domain delegated to Sedo or Afternic is inventory rather than a business, which
is the one thing DNS settles that reading the page cannot.

Refusals go the other way. A 403 from bot protection, an auth wall, a rate
limiter, or TLS with a certificate we would not accept all mean a server is
deployed under that name, whatever it is willing to tell us. So does a domain
that resolves and points at a host which never answers — a timeout is not
evidence of absence, and the conservative reading of one is that somebody is
there. All of those read as `taken`.

What is left genuinely undecided stays `unverified`, and it is a narrow band: a
5xx from a host that may be broken or may be abandoned, and a page too thin to
read whose nameservers are a registrar default that live sites use too. An
earlier version of this check called every one of these cases free, and cleared
`linear.com` and `asana.com` in a sample of ten live brands.

### Re-checking

`unverified` is a statement about a moment, not a verdict, so it is worth asking
again later:

```bash
npm run recheck -- <runId>                     # every unverified cell
npm run recheck -- <runId> playStore           # just one check
npm run recheck -- <runId> tld:com --include-clear # revisit 'free' too
```

`--include-clear` exists for the case where a checker itself was wrong: a stored
`free` from a checker that used to be too generous looks exactly like a sound
one, and nothing else will ever revisit it. It never touches `taken`, which was
a positive finding. Because it can multiply the work by a hundred, it prices the
job first and refuses anything over ten minutes without `--yes`.

## Tuning

Everything the worker paces itself by, all optional:

| variable                  | default        | what it changes                                        |
| ------------------------- | -------------- | ------------------------------------------------------ |
| `INOA_MODEL`              | the CLI's own  | which model the Claude CLI generates with              |
| `INOA_GENERATOR`          | CLI, then keys | which sources generate, and in what order              |
| `INOA_AI`                 | on             | `off` composes names here instead of asking a model    |
| `INOA_ANTHROPIC_MODEL`    | claude-opus-5  | model for the Anthropic API source                     |
| `INOA_OPENAI_MODEL`       | gpt-5.6        | model for the OpenAI source                            |
| `INOA_BATCH_SIZE`         | 50             | names asked for per generation call                    |
| `INOA_CONCURRENCY`        | 5              | generation calls in flight at once                     |
| `INOA_CHECK_CONCURRENCY`  | 8              | names checked at once                                  |
| `INOA_REUSE_DAYS`         | 14             | how long an earlier verdict may be reused; 0 disables  |
| `INOA_SCRAPE_INTERVAL_MS` | 5000           | minimum gap between scrapes; 0 scrapes every name      |
| `INOA_SCRAPE_ENGINES`     | off            | re-enable HTTP scraping, e.g. `bing` or `bing,google`  |
| `INOA_WEB_INTERVAL_MS`    | 60000          | gap between browser web checks, when no API key is set |
| `INOA_WEB_BACKOFF_MS`     | 1800000        | how long to stand down after a search engine objects   |

`INOA_WEB_INTERVAL_MS` and `INOA_WEB_BACKOFF_MS` apply only to the
browser fallback; with any search provider configured the web check runs in the
funnel at a couple of seconds a name. `INOA_SCRAPE_INTERVAL_MS` governs
nothing until `INOA_SCRAPE_ENGINES` turns scraping back on.

## Reusing verdicts

The same name comes up across runs, and re-checking one costs an Apple call, a
Play scrape and a search credit to re-learn something already on record. A
verdict from an earlier run is reused when it is recent enough —
`INOA_REUSE_DAYS`, 14 by default, `0` to disable.

Bounded by age because a verdict is a fact about a moment: domains lapse, apps
ship, companies fold. Only `free` and `taken` are borrowed; `unverified` means
the check could not answer, and reusing that would preserve a failure instead
of retrying it. A reused cell says so in its tooltip, with how old it is.

## The web check

One tier, for now. A **search API** answers the web check; a real browser
against Google is the fallback when no key is configured.

### The scraped tier is parked

Reading search engines over plain HTTP is switched off. It is still in the
code — `INOA_SCRAPE_ENGINES=bing` (or `bing,google`) brings it back — but
it ships off, for three reasons.

**Google cannot be scraped at all.** Search requires JavaScript: a plain request
returns `200` with 89 KB of script and a `<noscript>` redirect to
`/httpservice/retry/enablejs`. No address, header set, user agent or `gbv=1`
changes it. That is a _capability_ gate, and it is worth distinguishing from the
reputation one — both were visible in a single session, the browser tier getting
`/sorry/` from Google's abuse system while plain HTTP got `enablejs` from its
capability system.

**Bing can be scraped, but not relied on.** It answers some queries with a
complete, well-formed results page about something else entirely — `Duolingo`
returned French holiday calendars, apartment listings and the Assam State Portal
on consecutive attempts, ten valid result blocks each time. It answered the same
query correctly from two other addresses. So treat it as something an engine may
do to you rather than a property of the query.

**And it was never load-bearing.** It resolved about one check in 585. That is
not a defect in the engines: by the time a name reaches the web check it has
passed the `.com`, App Store and Play Store gates, so it is probably genuinely
free — and a scraped engine can confirm a _collision_ but never an _absence_.
Confirming absence is the paid tier's job, and Bing never says "no results"; it
pads with unrelated ones.

The guard that made it safe stays in the code for when it returns: a scraped
result is trusted only when it actually **mentions the name**, which is the
evidence the engine understood the question. Everything else escalates.

`npm run doctor` probes every engine whether or not it is in use, and reports
which would answer from where you are — so switching it back on later is a
measurement rather than a guess.

**This means a search API key is effectively required.** Without one the browser
fallback is all that remains, and it is challenged on sight from many addresses.
Run `npm run doctor` before a long run.

### Why it runs on its own clock

Domains, App Store and Play Store always run inline, paced against limits that
announce themselves — Apple says 403 at around twenty calls a minute. Where the
web check runs depends on whether you have an API key.

**With a key** it joins them inline, at a couple of seconds a name, because an
API has an ordinary quota rather than a temper.

**Without one** it is deferred to a queue drained afterwards at
`INOA_WEB_INTERVAL_MS` — a minute a name by default — because the browser
fallback drives Google, and search engines do not announce anything. Google
gives no warning, then serves its `/sorry/` interstitial, and the penalty
outlasts the run. How much volume it tolerates varies by address: originally
measured here at roughly 25 queries, then still blocking half an hour later, in
both headless and headed real Chrome; from three later addresses it was
challenged on the very first query. Treat 25 as an upper bound, not a budget,
and run `npm run doctor` to see where you actually stand.

Spacing the queries makes tripping it less likely. But the queue earns its keep
on the other side of that: once blocked, an inline check keeps calling and marks
every remaining name `unverified` in seconds — the run finishes fast, tells you
nothing, and the names _look_ checked. The queue notices, pauses for
`INOA_WEB_BACKOFF_MS`, retries the same name, and gives up out loud after
three attempts.

That pausing applies **only** to the browser queue. With a provider configured
the queue never drives a browser, so a Google challenge cannot stop it — a
provider hiccup on one name used to fall through to Google, come back
"challenged", and cost the run thirty minutes of sleep and eventually every
remaining name.

Only names that survived the earlier gates are queued, which is what makes a
minute apiece affordable.

**Set an API key.** The browser fallback gives a better answer than any scraper —
Google says "did not match any documents" outright, a positive statement of
absence — but it does not survive volume, and it reports `unverified` the moment
it is challenged rather than trying to look like something it isn't.

Configure as many as you like — they are used **in rotation**, so a run spreads
across every allowance instead of draining one and then failing:

| env var             | free allowance                 | card     |
| ------------------- | ------------------------------ | -------- |
| `TAVILY_API_KEY`    | 1,000 searches/month, renews   | no       |
| `FIRECRAWL_API_KEY` | free monthly credits           | no       |
| `EXA_API_KEY`       | $10 credit/month               | no       |
| `SERPER_API_KEY`    | 2,500 once, then $0.30/1,000   | for paid |
| `BRAVE_API_KEY`     | $5 credit/month, then $5/1,000 | yes      |

Every name reaches a configured provider, since the scraped tier is off, and
rotation is what keeps that affordable.

Should you re-enable scraping, note that the two are limited in different ways:
a scraped engine is banned by _rate_, an API is billed by _volume_. They are
paced separately for that reason — `INOA_SCRAPE_INTERVAL_MS` bounds the
scrape to one request every few seconds and _skips_ it rather than waiting when
no slot is free, because a free tier that stalls the run costs more than the
credit it saves.

Tavily is the default recommendation: the allowance renews monthly and there is
no card on file, so a runaway loop cannot produce a bill. Brave is listed last
because its genuinely-free tier ended in February 2026 — the card it collects
at signup now gets charged past the included credit.
