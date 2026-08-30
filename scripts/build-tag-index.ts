/** Dev-time: build the tag<->vocabulary index once and ship it. */
import { writeFile } from 'node:fs/promises';
import { CONCEPTS } from '../data/concepts.ts';
import { MORPHEMES } from '../data/morphemes.ts';
import { LEXICON } from '../data/lexicon.ts';
import { COMPOUND_WORDS } from '../data/word-bank.ts';
import { meansLike, triggers } from '../sources/thesaurus.ts';
import { mapLimit } from '../core/net.ts';
import { normalize } from '../core/text.ts';

const tags = [...new Set([...CONCEPTS, ...MORPHEMES, ...LEXICON, ...COMPOUND_WORDS].flatMap((x) => x.tags))].sort();
process.stderr.write(`building index for ${tags.length} tags...\n`);

let done = 0;
const rows = await mapLimit(tags, 6, async (tag) => {
  const [near, trg] = await Promise.all([meansLike(tag, 25), triggers(tag, 25)]);
  const words = [...new Set([...near, ...trg].map(normalize))]
    .filter((w) => w.length >= 3 && w.length <= 14 && w !== tag);
  done++;
  if (done % 25 === 0) process.stderr.write(`  ${done}/${tags.length}\n`);
  return [tag, words.slice(0, 40)] as const;
});

const body = rows.filter(([, w]) => w.length > 0).map(([t, w]) => `  ${t.includes('-') ? `'${t}'` : t}: '${w.join(' ')}',`).join('\n');
await writeFile(new URL('../data/tag-vocabulary.ts', import.meta.url), `/**
 * Tag → vocabulary index, generated once from Datamuse and committed.
 *
 * The bridge from a brief's words to this engine's concept tags used to be a
 * hand-written lookup of about a hundred words. Anything outside it — 'mortgage
 * underwriting for credit unions' — mapped to nothing and fell back to generic
 * material, so unrelated briefs produced the same shortlist.
 *
 * This index inverts that: each tag carries the words that mean it or occur
 * with it, so ANY brief can be matched by intersecting its expanded vocabulary
 * against these sets. Generated at build time and shipped, so it costs nothing
 * at runtime and works offline.
 *
 * Regenerate with scripts/build-tag-index.ts when the banks gain new tags.
 */

/** Space-separated to keep the file compact; split on load. */
const RAW: Record<string, string> = {
${body}
};

export const TAG_VOCABULARY: Map<string, Set<string>> = new Map(
  Object.entries(RAW).map(([tag, words]) => [tag, new Set(words.split(' '))]),
);

/** Every word that implies at least one tag, mapped to the tags it implies. */
export const WORD_TO_TAGS: Map<string, string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const [tag, words] of TAG_VOCABULARY) {
    for (const word of words) {
      const list = index.get(word);
      if (list) list.push(tag);
      else index.set(word, [tag]);
    }
  }
  return index;
})();
`, 'utf8');

process.stderr.write(`wrote ${rows.length} tags\n`);
