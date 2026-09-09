/**
 * Names without a model.
 *
 * Every other source in this project asks something else to be creative. This
 * one composes names itself, from a brief, a word list and a set of rules —
 * for a machine with no key and no subscription, for a run that must not cost
 * anything, and for anyone who would rather not send their unannounced idea to
 * a third party at all.
 *
 * It is deliberately not a fallback for a model that failed mid-run. A source
 * that quietly changes what it is halfway through leaves a table where half
 * the names came from one thing and half from another with nothing recording
 * which — see generate.ts, which chooses this path up front or not at all.
 *
 * Deterministic in the useful sense: the same brief and the same seed produce
 * the same names, so a run can be reproduced and a bug in it can be found
 * twice. Not deterministic in the useless sense of always producing the same
 * name — the seed advances with each batch.
 */

import { STRATEGIES, type StrategyId } from '../src/lib/types.ts';
import {
    CODA,
    ENDING,
    FOREIGN,
    INVENTED_TAIL,
    MAX_PART,
    METAPHOR,
    NOT_A_NAME,
    NUCLEUS,
    ONSET,
    QUALITY,
    SUBSTANCE,
    TOO_PLAIN,
    pronounceable
} from './words.ts';

export interface Composed {
    name: string;
    rationale: string;
    strategy: StrategyId;
}

/**
 * A small deterministic PRNG.
 *
 * Math.random cannot be seeded, and a generator that cannot be replayed cannot
 * be debugged: 'it produced a bad name once' is not a report anybody can act
 * on. mulberry32 is thirty years of arithmetic in four lines and more than
 * good enough to choose words with.
 */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A stable number for a string, so the same brief seeds the same run. */
function hash(text: string): number {
    let h = 2166136261;
    for (const ch of text) {
        h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    }
    return h >>> 0;
}

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The words in the brief worth building on.
 *
 * Everything a brief says about itself is in a handful of nouns; the rest is
 * grammar. Dropping the plain ones matters more than it sounds — a marketplace
 * brief is full of 'platform' and 'online', and a name built from those is the
 * name every competitor already has.
 */
export function keywords(brief: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of brief.toLowerCase().split(/[^a-z]+/)) {
        const word = raw.replace(/(ing|ed|s)$/, '');
        if (word.length < 4 || TOO_PLAIN.has(word) || TOO_PLAIN.has(raw) || seen.has(word)) {
            continue;
        }
        seen.add(word);
        out.push(word);
    }
    return out;
}

/**
 * Words related to the brief's own, from a free thesaurus.
 *
 * Datamuse needs no key and no account, which is the only reason it is here:
 * anything requiring either would defeat the purpose of the path it serves.
 * A failure is not an error — the bundled lists are the answer when there is
 * no network, and that is the case this whole module exists for.
 */
export async function relatedWords(brief: string, signal?: AbortSignal): Promise<string[]> {
    const roots = keywords(brief).slice(0, 4);
    const found = new Set<string>();

    await Promise.all(
        roots.map(async (root) => {
            try {
                const response = await fetch(
                    `https://api.datamuse.com/words?ml=${encodeURIComponent(root)}&max=25`,
                    { signal: signal ?? AbortSignal.timeout(8000) }
                );
                if (!response.ok) {
                    return;
                }
                const rows = (await response.json()) as { word: string; tags?: string[] }[];
                for (const row of rows) {
                    const word = row.word.toLowerCase();
                    /*
                     * Nouns and adjectives only, and short ones. Single words
                     * too — a thesaurus returns phrases, and half a phrase in
                     * a compound reads as a mistake.
                     *
                     * Taking everything gave 'interface', 'topical' and
                     * 'resident' equal standing with 'orchard' and 'harvest',
                     * and they compound about as well as they sound. A verb is
                     * worse still: a name is a thing, not an action.
                     */
                    const usable = row.tags?.some((tag) => tag === 'n' || tag === 'adj') ?? false;
                    if (usable && /^[a-z]{3,8}$/.test(word) && !TOO_PLAIN.has(word)) {
                        found.add(word);
                    }
                }
            } catch {
                // No network, or none in time. The bundled lists stand.
            }
        })
    );

    return [...found];
}

/** Pick one, deterministically. */
const pick = <T>(list: readonly T[], rand: () => number): T =>
    list[Math.floor(rand() * list.length)] as T;

/**
 * Blend two words where they already agree.
 *
 * A portmanteau works when the seam is invisible, which happens when the end
 * of one word and the start of the other share letters: swift + sylva meet at
 * the 's'. Without an overlap the join is just two words stuck together, which
 * is the compound approach wearing a different hat, so this returns null and
 * lets the caller try another pair.
 */
export function blend(left: string, right: string): string | null {
    for (let overlap = Math.min(3, left.length - 2, right.length - 2); overlap >= 1; overlap--) {
        if (left.slice(-overlap) === right.slice(0, overlap)) {
            return left + right.slice(overlap);
        }
    }
    // A vowel seam reads cleanly even without shared letters: nova + orbit.
    if (/[aeiou]$/.test(left) && /^[aeiou]/.test(right)) {
        return left + right.slice(1);
    }
    return null;
}

/** An invented stem: onset, vowel, and usually a coda, then a name-like tail. */
function invent(rand: () => number): string {
    const syllables = rand() < 0.45 ? 1 : 2;
    let word = '';
    for (let i = 0; i < syllables; i++) {
        word += pick(ONSET, rand) + pick(NUCLEUS, rand);
        if (rand() < 0.5) {
            word += pick(CODA, rand);
        }
    }
    return word + pick(INVENTED_TAIL, rand);
}

export interface Palette {
    /** Brief words and their thesaurus relatives, best first. */
    related: string[];
}

/**
 * One name, for one approach.
 *
 * Returns null rather than retrying internally: the caller is already looping
 * to fill a batch and is the right place to decide how hard to try. A rule
 * that cannot produce a usable name from the words it was given should say so
 * and let the next attempt draw different ones.
 */
function compose(
    strategy: StrategyId,
    palette: Palette,
    rand: () => number,
    roots: readonly { word: string; gloss: string; from: string }[]
): Composed | null {
    const { related } = palette;
    const subject = related.length > 0 ? related : SUBSTANCE;

    if (strategy === 'compound') {
        const head = pick(rand() < 0.6 ? subject : SUBSTANCE, rand);
        const tail = pick(rand() < 0.5 ? ENDING : QUALITY, rand);
        // A compound has a budget, and most of it belongs to the half that
        // carries the meaning: 'Residenthicket' is two fair words and one
        // unusable name.
        if (head === tail || head.length > MAX_PART || tail.length > MAX_PART) {
            return null;
        }
        return {
            name: capitalise(head) + tail,
            rationale: `${head} + ${tail}`,
            strategy
        };
    }

    if (strategy === 'portmanteau') {
        const left = pick(subject, rand);
        const right = pick(rand() < 0.5 ? SUBSTANCE : QUALITY, rand);
        const tooLong = left.length > MAX_PART || right.length > MAX_PART;
        const joined = left === right || tooLong ? null : blend(left, right);
        return joined
            ? { name: capitalise(joined), rationale: `${left} blended with ${right}`, strategy }
            : null;
    }

    if (strategy === 'metaphor') {
        const figure = pick(METAPHOR, rand);
        // Half plain, half with a modifier, so a run does not read as a list
        // of nouns lifted from the same page.
        if (rand() < 0.5) {
            return { name: capitalise(figure), rationale: `${figure}, as a figure`, strategy };
        }
        const modifier = pick(QUALITY, rand);
        return {
            name: capitalise(modifier) + figure,
            rationale: `${modifier} + ${figure}, as a figure`,
            strategy
        };
    }

    if (strategy === 'foreign') {
        if (roots.length === 0) {
            return null;
        }
        const root = pick(roots, rand);
        if (rand() < 0.55) {
            return {
                name: capitalise(root.word),
                rationale: `${root.word} — ${root.from} for ${root.gloss}`,
                strategy
            };
        }
        const tail = pick(ENDING, rand);
        return {
            name: capitalise(root.word) + tail,
            rationale: `${root.word} (${root.from}, ${root.gloss}) + ${tail}`,
            strategy
        };
    }

    if (strategy === 'short') {
        const word =
            pick(ONSET, rand) + pick(NUCLEUS, rand) + (rand() < 0.5 ? pick(CODA, rand) : '');
        if (word.length < 3 || word.length > 5 || NOT_A_NAME.has(word)) {
            return null;
        }
        return { name: capitalise(word), rationale: 'short and abstract', strategy };
    }

    const word = invent(rand);
    return { name: capitalise(word), rationale: 'invented', strategy };
}

/**
 * A batch of names, composed rather than generated.
 *
 * `avoid` is honoured the same way the model path honours it, and matters more
 * here: a rule drawing from a finite word list will repeat itself long before
 * a model would, and a run of a thousand names has to keep finding new ones.
 * When it genuinely cannot, it returns what it has — the caller reads a short
 * batch as an exhausted brief and stops, which is the truth.
 */
export function composeBatch(
    palette: Palette,
    strategy: StrategyId,
    count: number,
    avoid: string[],
    seed: number,
    /** Languages to draw foreign roots from. Empty means all of them. */
    languages: string[] = []
): Composed[] {
    const rand = seeded(seed);
    /*
     * Filtered by the language names in the bundled list, which is why those
     * strings and the `covers` lists in $lib/languages have to agree. A
     * selection this word list has nothing for leaves no roots, and the batch
     * comes back short rather than quietly ignoring the constraint.
     */
    const roots =
        languages.length > 0 ? FOREIGN.filter((r) => languages.includes(r.from)) : FOREIGN;
    const taken = new Set(avoid.map((name) => name.toLowerCase()));
    const out: Composed[] = [];

    // Bounded rather than 'until we have enough': a narrow brief can run out of
    // combinations, and an unbounded loop would spin instead of saying so.
    for (let attempt = 0; attempt < count * 40 && out.length < count; attempt++) {
        const made = compose(strategy, palette, rand, roots);
        if (!made || !pronounceable(made.name)) {
            continue;
        }
        const key = made.name.toLowerCase();
        // NOT_A_NAME here as well as in the short rule: any approach can land
        // on a fragment, and one place to reject them is one place to fix.
        if (taken.has(key) || NOT_A_NAME.has(key)) {
            continue;
        }
        taken.add(key);
        out.push(made);
    }

    return out;
}

/** Everything the composer draws on for one brief, gathered once. */
export async function paletteFor(brief: string): Promise<Palette> {
    return { related: await relatedWords(brief) };
}

/** A seed that is stable for a brief and different for every batch. */
export const seedFor = (brief: string, batch: number): number => hash(brief) + batch * 7919;

/** The approaches this generator knows, which is all of them. */
export const OFFLINE_STRATEGIES: StrategyId[] = STRATEGIES.map((s) => s.id);
