/**
 * Build the English word bank from Datamuse, at build time.
 *
 * Replaces a hand-authored list. Nothing here is chosen by a person: the words
 * are enumerated by spelling pattern, filtered on metadata Datamuse supplies
 * (part of speech, frequency, syllable count), and glossed from
 * dictionaryapi.dev. The only judgement encoded is structural — what shape of
 * word can carry half of a compound — and that comes from the engine's own
 * constraints, not from taste.
 *
 *   node scripts/build-word-bank.ts
 *
 * Writes data/word-bank.ts. Re-run when you want fresher material; the result
 * is committed so runs stay fast and `--offline` keeps working.
 */

import { writeFile } from 'node:fs/promises';
import { getJSON, mapLimit } from '../core/net.ts';
import { profile } from '../core/phonology.ts';
import { normalize } from '../core/text.ts';
import { WORD_TO_TAGS } from '../data/tag-vocabulary.ts';

interface DictEntry {
  meanings: { partOfSpeech: string; definitions: { definition: string }[] }[];
}

/**
 * dictionaryapi.dev returns intermittent 502s under any real concurrency, and
 * a failure cached as "no such word" would silently shrink the bank. Retry, and
 * never cache the negative.
 */
async function gloss(word: string): Promise<{ text: string; noun: boolean } | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await getJSON<DictEntry[]>(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { timeoutMs: 9000 },
    );
    if (Array.isArray(data) && data.length > 0) {
      const meanings = data.flatMap((e) => e.meanings ?? []);
      const nouns = meanings.filter((m) => m.partOfSpeech === 'noun');
      const ordered = [...nouns, ...meanings].flatMap((m) =>
        (m.definitions ?? []).map((d) => d.definition),
      );
      const text = pickDefinition(ordered);
      if (text) return { text, noun: nouns.length > 0 };
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return undefined;
}

/**
 * Words no harvest should put into a brand name.
 *
 * Fetched from an open dataset rather than written here. This is a generator
 * quality gate, not a product feature: it stops the sweep proposing 'Ass' and
 * 'Gay' as naming material. Candidate names are still not screened at runtime.
 */
async function unsuitableWords(): Promise<Set<string>> {
  const url =
    'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch the exclusion list: ${response.status}`);
  const text = await response.text();
  return new Set(
    text
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0 && !line.includes(' ')),
  );
}

/**
 * dictionaryapi.dev orders senses arbitrarily, so the first one is often the
 * obscure one — 'sad' came back as the name of an Arabic letter. Prefer a
 * definition that reads like the word's ordinary meaning.
 */
function pickDefinition(candidates: string[]): string | undefined {
  const usable = candidates
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .filter((d) => d.length >= 12 && d.length <= 120)
    // Non-Latin script means a foreign-alphabet sense, not the English word.
    .filter((d) => !/[^\u0000-\u024F\u2018-\u201D]/.test(d))
    .filter((d) => !/^\((obsolete|archaic|slang|vulgar|dialect|chiefly)/i.test(d));
  return usable[0];
}

interface DatamuseWord {
  word: string;
  numSyllables?: number;
  tags?: string[];
}

/**
 * Spelling patterns, partitioned by first letter.
 *
 * A bare '?????' asks for every five-letter word and Datamuse caps the answer
 * at 1000 — of which there are tens of thousands, returned in no useful order.
 * That truncation is why an earlier build produced a bank containing 'rue',
 * 'din' and 'ash' but not 'stone', 'iron', 'fire', 'gate' or 'warm'.
 *
 * Partitioning by initial letter gives each slice its own 1000-word budget, so
 * the sweep actually covers the lexicon instead of an arbitrary corner of it.
 */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const LENGTHS = [3, 4, 5, 6];
const PATTERNS = LENGTHS.flatMap((length) =>
  LETTERS.map((letter) => letter + '?'.repeat(length - 1)),
);

/** Words per million. Below this, a reader does not recognize the word. */
const MIN_FREQUENCY = 3;

function tagsOf(row: DatamuseWord): { pos: Set<string>; frequency: number } {
  const pos = new Set<string>();
  let frequency = 0;
  for (const tag of row.tags ?? []) {
    if (tag.startsWith('f:')) frequency = Number.parseFloat(tag.slice(2));
    else pos.add(tag);
  }
  return { pos, frequency };
}

async function harvest(): Promise<DatamuseWord[]> {
  process.stderr.write(`sweeping ${PATTERNS.length} spelling patterns\n`);
  const rows = await mapLimit(PATTERNS, 4, async (pattern) => {
    const data = await getJSON<DatamuseWord[]>(
      `https://api.datamuse.com/words?sp=${pattern}&md=pfs&max=1000`,
      { ttlMs: 7 * 24 * 60 * 60 * 1000 },
    );
    return data ?? [];
  });
  return rows.flat();
}

const [rows, unsuitable] = await Promise.all([harvest(), unsuitableWords()]);
process.stderr.write(`harvested ${rows.length} words; ${unsuitable.size} excluded terms\n`);

const candidates = rows.filter((row) => {
  if (unsuitable.has(row.word)) return false;
  const { pos, frequency } = tagsOf(row);
  if (frequency < MIN_FREQUENCY) return false;
  // One beat only. Two words of two syllables cannot make a name, and the
  // engine's own three-syllable ceiling would discard the result anyway.
  if (row.numSyllables !== 1) return false;
  if (!pos.has('n') && !pos.has('adj')) return false;
  const word = normalize(row.word);
  if (word !== row.word || word.length < 3) return false;
  // The same phonotactic gate the generators apply, so nothing enters the bank
  // that cannot survive being joined to another word.
  const p = profile(word);
  return p.illegalClusters.length === 0 && p.ambiguous.length === 0;
});

process.stderr.write(`${candidates.length} pass the structural filter; glossing...\n`);

let done = 0;
const glossed = await mapLimit(candidates, 3, async (row) => {
  const definition = await gloss(row.word);
  done++;
  if (done % 50 === 0) process.stderr.write(`  ${done}/${candidates.length}\n`);
  if (!definition) return undefined;

  const { pos } = tagsOf(row);
  // A word that is only ever an adjective qualifies; one that is only ever a
  // noun is the thing being qualified. Datamuse supplies this, so the roles
  // that used to be assigned by hand are now read off the data.
  const role = pos.has('n') && pos.has('adj') ? 'any' : pos.has('adj') ? 'mod' : 'head';
  // Concept tags come from the generated tag index, so a word's place in the
  // concept space is derived too rather than declared.
  const tags = WORD_TO_TAGS.get(row.word) ?? [];
  return {
    word: row.word,
    gloss: definition.text.replace(/\s+/g, ' ').replace(/'/g, '’').slice(0, 90),
    role,
    tags,
  };
});

type BankEntry = { word: string; gloss: string; role: 'head' | 'mod' | 'any'; tags: string[] };
const bank: BankEntry[] = glossed.filter(
  (w): w is BankEntry => w !== undefined && w.gloss.length > 0,
);
process.stderr.write(`${bank.length} words glossed\n`);

const body = bank
  .map((w) => `  ['${w!.word}', '${w!.gloss}', '${w!.role}', '${w!.tags.join(' ')}'],`)
  .join('\n');

await writeFile(
  new URL('../data/word-bank.ts', import.meta.url),
  `/**
 * English word bank — GENERATED, do not edit by hand.
 *
 * Built by scripts/build-word-bank.ts from Datamuse (enumeration, part of
 * speech, frequency, syllable count) and dictionaryapi.dev (glosses). Every
 * entry is a single-syllable common noun or adjective above ${MIN_FREQUENCY} uses per
 * million that survives the engine's own phonotactic gate.
 *
 * Roles are read from part-of-speech data rather than assigned: a word that is
 * only an adjective can qualify another ('true'), a word that is only a noun is
 * the thing qualified ('stone'), and a word that is both can take either seat.
 */

export interface CompoundWord {
  word: string;
  gloss: string;
  tags: string[];
  role: 'head' | 'mod' | 'any';
}

const RAW: [string, string, CompoundWord['role'], string][] = [
${body}
];

export const COMPOUND_WORDS: CompoundWord[] = RAW.map(([word, gloss, role, tags]) => ({
  word,
  gloss,
  tags: tags ? tags.split(' ') : [],
  role,
}));

/** Words that must not sit at the front of a compound. */
export const HEAD_ONLY = new Set(
  COMPOUND_WORDS.filter((w) => w.role === 'head').map((w) => w.word),
);

/** Words that must not sit at the end of a compound. */
export const MOD_ONLY = new Set(COMPOUND_WORDS.filter((w) => w.role === 'mod').map((w) => w.word));
`,
  'utf8',
);

process.stderr.write('wrote data/word-bank.ts\n');
