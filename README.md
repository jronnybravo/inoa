# Brandy

Generate brand names from a brief, then screen each one against the places a
name can already be taken: the `.com`, the App Store, Google Play, and the web.

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
DB_USERNAME=brandy
DB_PASSWORD=secret
DB_DATABASE=brandy
```

```bash
DATABASE_URL=postgresql://user:pass@host/brandy   # or just this
```

SQLite needs only `DB_TYPE=sqlite` and `DB_DATABASE=./brandy.sqlite`. Install
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
docker run -d --name brandy-pg -e POSTGRES_PASSWORD=brandy -e POSTGRES_DB=brandy -p 55432:5432 postgres:16-alpine
```

then set `DATABASE_URL=postgresql://postgres:brandy@localhost:55432/brandy`.

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
npm run lint      # eslint + prettier --check
npm run format    # prettier --write
npm run check     # svelte-check, which also typechecks the worker
```

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

## Trademark strength

Every name is placed on the Abercrombie spectrum — the taxonomy US trademark
law uses for distinctiveness, from _Abercrombie & Fitch v. Hunting World_
(1976). Weakest first: **generic**, **descriptive**, **suggestive**,
**arbitrary**, **fanciful**.

It answers a different question from the availability checks. Those say whether
a name is taken; this says whether it could be owned, and the two come apart. A
name can be free on the domain, both stores and the web and still be too
descriptive to register or defend.

Two ends are decided here, with no model and no API call. A name with no
dictionary root is invented, so it is fanciful whatever anyone thinks. A name
built from the brief's own vocabulary is describing the category — `Namekeep`
for a naming tool is descriptive however it is dressed up. The middle,
suggestive against arbitrary, turns on meaning, so the model supplies it in the
same response that generates the name. No extra call, no extra credit.

This is an indication, not legal advice. The classification is a judgement, and
where it can be proved rather than judged the tooltip says so.

## SMILE

Alongside distinctiveness, each name is judged against the SMILE checklist from
Alexandra Watkins' _Hello, My Name Is Awesome_: **evocative**, **memorable**,
**imagery**, **legs**, **emotional**. The column shows the mnemonic with the
qualities a name actually has picked out, so `Terravin` reading `S_I__` means
evocative and imagery, and nothing else claimed.

A checklist, not scores. Counting qualities a name has is honest; inventing
'memorability: 73' is not, and a number that cannot be argued with is worse
than a letter that can. The model is told to be strict, and in practice names
come back with one or two qualities rather than all five.

Note that SMILE's 'suggestive' is not Abercrombie's. There it is a legal
category about distance from describing the goods; here it means the name
evokes the brand experience. It is labelled **Evocative** in this table so the
two cannot be confused.

## Reusing verdicts

The same name comes up across runs, and re-checking one costs an Apple call, a
Play scrape and a search credit to re-learn something already on record. A
verdict from an earlier run is reused when it is recent enough —
`BRANDY_REUSE_DAYS`, 14 by default, `0` to disable.

Bounded by age because a verdict is a fact about a moment: domains lapse, apps
ship, companies fold. Only `free` and `taken` are borrowed; `unverified` means
the check could not answer, and reusing that would preserve a failure instead
of retrying it. A reused cell says so in its tooltip, with how old it is.

## The web check

Two tiers. Plain HTTP against Bing and Google first, because it is fast and
right for names that are obviously taken. A real browser or the Brave API only
when that tier cannot be believed.

"Cannot be believed" is doing real work there. Bing answers some queries with a
complete, well-formed results page about something else entirely — searching
`Duolingo` returned French holiday calendars, apartment listings and the Assam
State Portal on consecutive attempts, ten valid result blocks each time. It is
stable per query rather than intermittent, so retrying does not help. Google
over plain HTTP returns 200 with nothing parseable, because its results are
rendered by script.

So the HTTP tier is trusted only when its results actually **mention the name**.
That is the evidence the engine understood the question. Everything else
escalates.

### Why it runs on its own clock

Checking happens in two phases. `.com`, App Store and Play Store run inline,
paced against limits that announce themselves — Apple says 403 at around twenty
calls a minute. The web check is drained afterwards, one name a minute.

Search engines do not announce anything. Google gives no warning, then serves
its `/sorry/` interstitial, and the penalty outlasts the run: measured here, it
tripped after roughly 25 queries and was still blocking half an hour later, in
both headless and headed real Chrome.

Spacing the queries makes tripping it less likely. But the queue earns its keep
on the other side of that: once blocked, an inline check keeps calling and marks
every remaining name `unverified` in seconds — the run finishes fast, tells you
nothing, and the names _look_ checked. The queue notices, pauses, retries the
same name, and gives up out loud after three attempts.

Only names that survived the earlier gates are queued, which is what makes a
minute apiece affordable. And most never reach Google at all: names that are
obviously taken are resolved by the HTTP tier for free.

Set a tier-2 API key if you can. The browser fallback gives a better answer
than any scraper — Google says "did not match any documents" outright, a
positive statement of absence — but it does not survive volume, and it reports
`unverified` the moment it is challenged rather than trying to look like
something it isn't.

Configure as many as you like — they are used **in rotation**, so a run spreads
across every allowance instead of draining one and then failing:

| env var             | free allowance                 | card     |
| ------------------- | ------------------------------ | -------- |
| `TAVILY_API_KEY`    | 1,000 searches/month, renews   | no       |
| `FIRECRAWL_API_KEY` | free monthly credits           | no       |
| `EXA_API_KEY`       | $10 credit/month               | no       |
| `SERPER_API_KEY`    | 2,500 once, then $0.30/1,000   | for paid |
| `BRAVE_API_KEY`     | $5 credit/month, then $5/1,000 | yes      |

The cheap Bing tier resolves very little in practice — one web check out of 585
on a full run — because a result set that never mentions the name is treated as
no answer rather than a clean one. So most names reach a configured provider,
and rotation is what keeps that affordable.

Tavily is the default recommendation: the allowance renews monthly and there is
no card on file, so a runaway loop cannot produce a bill. Brave is listed last
because its genuinely-free tier ended in February 2026 — the card it collects
at signup now gets charged past the included credit.
