# Inoa

Generate brand names from a brief, then screen each one against the places a
name can already be taken: the `.com`, the App Store, Google Play, and the web.

![A finished naming run: fifty candidates, each with a verdict per check](docs/screenshot.png)

Every cell is one of five states, and the third is the one that matters:
`free` found nothing, `taken` found somebody, and `unverified` means the check
could not get a trustworthy answer. A tool with only the first two turns every
failed lookup into a free name.

## Shape

Two halves, and the split is deliberate.

**The app** (SvelteKit on Vercel) takes the brief, verifies the email, and
displays results. Every function it runs is a sub-second read or write.

**The worker** (this machine) does everything expensive: generation through the
signed-in Claude CLI, then the checks. It exists because a run takes tens of
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

## How a name is judged

Checks run cheapest-first — `.com`, App Store, Play Store, web — because the
expensive ones are the rate-limited ones. Apple tolerates about 20 calls a
minute, so every name the `.com` gate drops is a name Apple never sees.

A **required** check that returns `taken` drops the name immediately and the
rest are marked skipped. An unrequired check never drops anything; it is
recorded so the table stays complete.

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
npm run recheck -- <runId> com --include-clear # revisit 'free' too
```

`--include-clear` exists for the case where a checker itself was wrong: a stored
`free` from a checker that used to be too generous looks exactly like a sound
one, and nothing else will ever revisit it. It never touches `taken`, which was
a positive finding. Because it can multiply the work by a hundred, it prices the
job first and refuses anything over ten minutes without `--yes`.

## Tuning

Everything the worker paces itself by, all optional:

| variable                  | default       | what it changes                                        |
| ------------------------- | ------------- | ------------------------------------------------------ |
| `INOA_MODEL`              | the CLI's own | which model generates names                            |
| `INOA_BATCH_SIZE`         | 50            | names asked for per generation call                    |
| `INOA_CONCURRENCY`        | 5             | generation calls in flight at once                     |
| `INOA_CHECK_CONCURRENCY`  | 8             | names checked at once                                  |
| `INOA_REUSE_DAYS`         | 14            | how long an earlier verdict may be reused; 0 disables  |
| `INOA_SCRAPE_INTERVAL_MS` | 5000          | minimum gap between scrapes; 0 scrapes every name      |
| `INOA_SCRAPE_ENGINES`     | off           | re-enable HTTP scraping, e.g. `bing` or `bing,google`  |
| `INOA_WEB_INTERVAL_MS`    | 60000         | gap between browser web checks, when no API key is set |
| `INOA_WEB_BACKOFF_MS`     | 1800000       | how long to stand down after a search engine objects   |

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

`.com`, App Store and Play Store always run inline, paced against limits that
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
