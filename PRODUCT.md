# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A founder naming their own company, product, or project. One person, high
stakes, a handful of intense sessions rather than daily use. They arrive with a
brief in their head and a shortlist of names they are already circling, and
they leave either with a name they can defend or with the knowledge that their
favourite has a problem.

The defining need is *why*, not *what*. A ranked list alone does not settle an
argument with a co-founder or a board; the reasoning, the risks, and the
availability evidence behind each name are what make a choice defensible.

## Product Purpose

Discover names people remember rather than names that describe. The user gives
a one-sentence brief; the engine builds an explicit strategic posture from it,
generates and mutates hundreds of candidates across every naming strategy,
scores them on eleven dimensions, screens them for meanings nobody intended,
and checks real availability for the finalists.

Success is a shortlist the user can act on: a name they understand the case
for, with domains and handles they can actually claim and a clear next step
into trademark clearance.

## Positioning

Most naming tools are word blenders with a domain lookup bolted on. This one
carries a defensible position on *why* a name works and shows its work:

- Generation is gated by phonotactics, so candidates are sayable by construction.
- Scoring is dominated by imagery — how much of a mental picture a name arrives
  with — and imagery decays as a root stops being audible in the finished name.
- Blocking meanings in any screened language, and "random syllables" with no
  morphological anchor, are vetoes that no favourable average can override.
- Availability is evidence, not decoration: RDAP is the registries' own
  protocol, and the app says `unknown` rather than guessing.

## Operating Context

A single page, used in one sitting. The user writes a brief, waits 10–30
seconds while the run streams its progress, then reads and interrogates the
shortlist. Runs are deterministic by seed, so a run can be reproduced exactly
and shared as a link.

Deployed publicly on the internet: anonymous, no accounts, and every run costs
CPU on the server plus outbound calls to public registries made on a stranger's
behalf. Abuse protection and visible cost are part of the product, not an
afterthought.

## Capabilities and Constraints

- Node SSR only. The engine resolves NS records over `node:dns`, reads the
  system word list from disk, and caches responses to the filesystem; static
  and edge runtimes cannot host it.
- A run takes 10–30 seconds and cannot be cancelled once started.
- Domain checks are authoritative (RDAP with DNS fallback). Handle checks are
  authoritative for GitHub and npm only; consumer social platforms block
  automated probes and are reported as indicative.
- **Trademark scores are estimates**, from a corpus of well-known marks plus
  sight/sound/relatedness heuristics. Not a clearance search, not legal advice.
  This limit must be stated wherever a trademark number appears, never buried.
- No saved run history and no accounts — explicitly out of scope. A run is
  reproducible from its URL instead.
- The deliverables are three: an explorable on-screen shortlist, a downloadable
  markdown report, and a path into real clearance.

## Brand Commitments

The product is named **brandy**. Existing voice, established in the engine's
source and README: plain, specific, and willing to state its own limits. It
explains mechanisms rather than asserting quality, and it never claims
authority it does not have.

## Evidence on Hand

- A working engine: 21 modules across sources, generators, analyzers,
  validators and scorers, plus curated corpora (`data/`).
- Real output to design against — every run produces genuine scored candidates,
  reasoning strings, risk lists, and live availability data.
- No customers, benchmarks, testimonials, pricing, or press. None may be
  invented anywhere in the interface.

## Product Principles

1. **Show the reasoning, always.** A score with no explanation is a number the
   user cannot defend to anyone else.
2. **State limits where the claim appears.** The trademark caveat belongs next
   to the trademark number, not in a footer.
3. **Unknown is an answer.** Never dress a missing result as a positive one.
4. **The brief is the whole input.** One sentence should be enough to start; the
   rest is optional refinement, never a form to complete.
5. **A run is reproducible.** Same seed, same result, shareable as a URL.

## Accessibility & Inclusion

No user-specific requirement was established. Standard obligations apply: the
progress stream must be announced to screen readers rather than being a purely
visual animation, score bars need text equivalents, and the app must remain
usable at 200% zoom and by keyboard alone.
