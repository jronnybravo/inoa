---
name: brandy
description: A naming engine that shows its work — linguistics field notation applied to brand discovery.
colors:
  ground: "#E9ECEF"
  ground-deep: "#DDE2E7"
  slip: "#FCFDFD"
  slip-alt: "#F4F6F8"
  ink: "#0E141B"
  ink-secondary: "#4A5763"
  ink-faint: "#78848F"
  rule: "#C4CCD4"
  rule-strong: "#9AA6B2"
  annotation: "#B32D18"
  annotation-wash: "#F6E2DE"
  stamp: "#15604F"
  stamp-wash: "#DDEAE5"
  focus: "#1C4FD8"
typography:
  display:
    fontFamily: "'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.022em"
  specimen:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1.9rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  notation:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.14em"
  measure:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
  scale:
    micro: "0.625rem"
    stamp: "0.6875rem"
    notation: "0.75rem"
    small: "0.8125rem"
    measure: "0.875rem"
    body: "0.9375rem"
    lead: "1.125rem"
    entry: "1.375rem"
    specimen: "1.9rem"
    display: "2.25rem"
    verdict: "2.4rem"
rounded:
  none: "0px"
  sm: "2px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  xxl: "64px"
components:
  slip:
    backgroundColor: "{colors.slip}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "24px 24px 24px 64px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.slip}"
    rounded: "{rounded.none}"
    padding: "14px 28px"
    typography: "{typography.notation}"
  button-primary-hover:
    backgroundColor: "{colors.annotation}"
    textColor: "{colors.slip}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "13px 20px"
    typography: "{typography.notation}"
  tick:
    backgroundColor: "{colors.slip-alt}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  tick-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.slip}"
  stamp-available:
    backgroundColor: "{colors.stamp-wash}"
    textColor: "{colors.stamp}"
    rounded: "{rounded.none}"
    padding: "3px 7px"
    typography: "{typography.notation}"
  stamp-taken:
    backgroundColor: "{colors.annotation-wash}"
    textColor: "{colors.annotation}"
  stamp-unknown:
    backgroundColor: "{colors.slip-alt}"
    textColor: "{colors.ink-faint}"
---

# brandy — design system

## Overview

**The world: a phonetics lab.** The interface borrows the working grammar of
linguistics field notation — ruled recording slips, numbered margin columns,
syllable brackets, CV skeletons, measured density columns, and corrections
written in red in the margin. It is the one world that lets this product show
its actual mechanism, because the engine's core *is* phonology: it syllabifies,
tests cluster legality, and measures sonority and vowel share.

**The thesis:** a name is a measured specimen, not a search result. The
arrangement this refuses is the category default — a big search bar over a grid
of equal cards with green "available" pills.

Mode is **Operate**. The user is completing a task under real stakes, so
notation never replaces plain language; every piece of notation is paired with
words a founder who has never seen an IPA chart can read.

## Colors

Restrained: a cool plotting ground, ink, hairline rules, one accent
(`annotation` red) plus one semantic stamp colour (`stamp` green) reserved for
availability verdicts.

- `ground` / `ground-deep` — the plotting surface the slips lie on.
- `slip` / `slip-alt` — recording sheets and their ruled bands.
- `ink` / `ink-secondary` / `ink-faint` — a three-step text hierarchy. Secondary
  text is tinted from the ground's hue, never neutral gray.
- `annotation` — risks, corrections, blocking findings, destructive states. It
  is the only decorative-adjacent colour and it is never used for decoration.
- `stamp` — an availability verdict of `available`, and nothing else.
- `focus` — keyboard focus rings only.

Light ground is chosen from the use scene: one founder at a desk, reading dense
comparative text and exporting a document. This is a reading and measuring
surface, not an ambient one.

Score magnitude is expressed as **ink density**, never as a coloured progress
bar: a column of ticks in `ink`, with unfilled ticks at `rule`. Colour carries
verdicts; ink carries quantity.

## Typography

One family — **Libre Franklin**, a workhorse American gothic that is the native
voice of forms, charts and scientific print — across headings, labels, data and
body. Fixed rem scale, ratio ~1.2. No display/body pairing.

- `display` — the masthead only.
- `specimen` — a candidate name on the sheet. The largest thing in any result row.
- `body` — prose, rationale, risks. Measure capped at 68ch.
- `notation` — uppercase, letter-spaced 0.14em field labels. This is the
  system's signature; it marks anything that is a *field name* rather than
  content.
- `measure` — numerals and data. Always `font-variant-numeric: tabular-nums`
  so columns align down the sheet.

Syllable splits are set in `specimen` size with hairline separators
(`lu·mo·ra`); CV skeletons are set in `notation` with wide tracking.

`typography.scale` is the full ramp the build settled on — eleven steps from
`micro` (density column heads) to `verdict` (the overall score). It is denser
at the small end than a marketing surface would be, because this interface is
mostly labels and measurements; the prose steps stay on a ~1.2 ratio.

**Two decisions that will look like findings to a linter, and are not:**

- *One font family.* Operate surfaces do not need a display/body pairing;
  hierarchy comes from the weight and size steps above. Adding a second family
  here would be the lapse, not the fix.
- *The grid-line background.* Decorative grid fields are a generated-UI
  signature and are banned by default — but this world is literally plotting
  paper, and the grid is the measurement surface the specimens are recorded on.
  It stays at 7% opacity so it never competes with content.

## Layout

A single scrolling column of **slips** on the plotting ground, max width
1180px. Every slip carries a 40px ruled left margin column holding its field
number or rank — this margin is the system's structural signature and appears
on every slip, at every breakpoint.

Rhythm: `xl` between slips, `lg` between bands inside a slip, `sm` inside a
group. More space above a heading than below it.

Responsive behaviour is structural, not fluid type. Below 900px the score grid
collapses from eleven columns to a two-column label/value list, the margin
column narrows to 28px, and specimen rows stack. Below 600px the availability
stamps wrap to their own band. Type sizes do not change.

## Elevation & Depth

Nearly flat — this is paper on a table, not floating glass. A slip sits on the
ground with a 1px `rule` border and a single soft shadow with real offset
(`0 1px 2px rgba(14,20,27,.06), 0 8px 24px -12px rgba(14,20,27,.18)`). No
zero-offset halos, no glass, no blur as decoration.

## Shapes

Square. `rounded.none` is the default for every surface, control and stamp;
`rounded.sm` (2px) is the maximum and is used only where a hairline corner
would alias badly. Rules are 1px `rule`; a doubled rule (1px + 3px gap + 1px)
marks a major band break, borrowed from ruled record sheets.

## Components

- **Slip** — the base container. White sheet, ruled left margin with a number,
  1px border. Never nested inside another slip.
- **Field label** — `notation` type above every input and data group.
- **Tick** — a small square selectable chip used for emotions and TLDs.
  Selected state inverts to ink; it never uses colour.
- **Density column** — eleven fixed-height tick columns, one per score
  dimension, with the dimension's `notation` label rotated beneath. Hovering or
  focusing a column writes its reasoning into the slip's right margin. Each
  column carries a text equivalent for screen readers.
- **Stamp** — availability verdict. Three variants only: available (stamp
  green), taken (annotation red), unknown (neutral). `unknown` is always
  rendered as its own state and never styled to imply a positive result.
  A stamp becomes a link when there is something to go and look at — a taken
  handle, a live site, an app listing. The anchor fills the whole chip so the
  target is the stamp, and it inherits the verdict's colour rather than turning
  link-blue: the status is the point, the link is a way to act on it. A verdict
  with nothing behind it (an unregistered domain) stays inert.
- **Margin annotation** — risks and cautions, set in `body` in `annotation`
  red, hanging in the left margin on wide screens.
- **Capture band** — the streaming progress state: a ruled measure with a
  moving tick, the current stage in `notation`, and candidate names printing
  in as they arrive. This is the one authored motion moment in the product.

Every control ships default, hover, focus-visible, active, disabled and
loading states. Focus is a 2px `focus` outline with a 2px offset, never removed.

## Do's and Don'ts

**Do**

- Pair every piece of notation with plain language.
- State the trademark limitation wherever a trademark number appears.
- Render `unknown` as a first-class verdict.
- Keep numerals tabular so columns compare down the page.
- Let ink density carry quantity and colour carry verdicts.

**Don't**

- Use coloured progress bars, sparklines, progress rings or gauge dials.
- Introduce a second type family, or use monospace as a costume — notation here
  is set in the one family, tracked.
- Put a card grid of equal-weight name cards on the page. The specimen sheet is
  a ranked, ruled list; rank must be visible in the composition itself.
- Add motion that does not convey state. The capture band is the only
  orchestrated moment.
- Use `annotation` red for anything that is not a risk, correction or
  destructive action.
