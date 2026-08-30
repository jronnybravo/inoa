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

```bash
cp .env.example .env      # fill in DATABASE_URL at minimum
npm run db:sync           # create the tables
npm run dev               # the app
npm run worker            # in a second terminal, on your machine
```

The worker needs a signed-in CLI: `claude login`.

## How a name is judged

Checks run cheapest-first — `.com`, App Store, Play Store, web — because the
expensive ones are the rate-limited ones. Apple tolerates about 20 calls a
minute, so every name the `.com` gate drops is a name Apple never sees.

A **required** check that returns `taken` drops the name immediately and the
rest are marked skipped. An unrequired check never drops anything; it is
recorded so the table stays complete.

Every cell has three real states, not two:

| state | meaning |
|---|---|
| `free` | we looked, and nothing is using it |
| `taken` | we looked, and found a collision |
| `unverified` | we could not get a trustworthy answer |

The third one is not decoration. A boolean cannot tell "it is free" apart from
"we could not find out", and rendering the second as a clean cell is how a
broken check disguises itself as a working one — which is exactly what happened
in the tool this replaces, silently, across 500 names.

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

Set `BRAVE_API_KEY` if you can. The browser fallback gives a better answer than
any scraper — Google says "did not match any documents" outright, a positive
statement of absence — but it does not survive volume, and it reports
`unverified` the moment it is challenged rather than trying to look like
something it isn't.
