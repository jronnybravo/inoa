/**
 * A record of names already put in front of someone.
 *
 * Varying the seed changes which material a run draws, but it cannot know what
 * previous runs produced — so a strong candidate keeps resurfacing, and a
 * second run of the same brief spends most of its shortlist on names you have
 * already rejected. This file is that memory.
 *
 * Matching is by exact name. Near-variants are NOT treated as the same thing:
 * 'Kizunyo' and 'Kizuneo' sound alike but they are different names, and
 * excluding one because the other was shown throws away a candidate you have
 * never actually seen. Resemblance is handled inside a single shortlist, where
 * two variants side by side read as padding; across runs they are simply two
 * different names.
 *
 * Append-only NDJSON rather than a rewritten map, because the web app can have
 * two runs finishing at once and a read-modify-write would lose one of them.
 * Duplicate lines are harmless: the reader folds them into a set.
 *
 * Not committed. Set BRANDY_HISTORY to move it, or delete the file to forget.
 */

import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { normalize } from './text.ts';

interface HistoryLine {
  name: string;
  brief: string;
  at: string;
  /** Source words this name was built from. */
  words?: string[];
}

const HISTORY_PATH = (() => {
  const configured = process.env.BRANDY_HISTORY;
  if (configured) return isAbsolute(configured) ? configured : join(process.cwd(), configured);
  return join(process.cwd(), '.brandy', 'seen.ndjson');
})();

let cache: Set<string> | undefined;
let wordCache: Map<string, number> | undefined;

/** Every name shown before. Read once per process, then kept in memory. */
export async function loadSeen(): Promise<Set<string>> {
  if (cache) return cache;
  const seen = new Set<string>();
  try {
    const raw = await readFile(HISTORY_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as HistoryLine;
        if (entry.name) seen.add(normalize(entry.name));
      } catch {
        // A truncated final line from an interrupted append; skip it.
      }
    }
  } catch {
    // No history yet.
  }
  cache = seen;
  return seen;
}

/**
 * How often each source word has been spent on a name already shown.
 *
 * Blocking a repeated *name* does not stop the same *material* being reused:
 * 'freya' turned up in ten of one hundred and forty names across six unrelated
 * briefs, because it is high-beauty and structurally ideal as a compound tail,
 * so every run reached for it. Counting usage lets later runs weight it down.
 */
export async function loadWordUsage(): Promise<Map<string, number>> {
  if (wordCache) return wordCache;
  const usage = new Map<string, number>();
  try {
    const raw = await readFile(HISTORY_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as HistoryLine;
        for (const word of entry.words ?? []) {
          usage.set(word, (usage.get(word) ?? 0) + 1);
        }
      } catch {
        // Truncated line from an interrupted append.
      }
    }
  } catch {
    // No history yet.
  }
  wordCache = usage;
  return usage;
}

/** Remember names that were shown, so later runs can skip them. */
export async function recordSeen(
  names: string[],
  brief: string,
  wordsFor?: Map<string, string[]>,
): Promise<void> {
  const fresh = names.map((n) => normalize(n)).filter((n) => n.length > 0);
  if (fresh.length === 0) return;

  const at = new Date().toISOString();
  const lines = fresh
    .map((name) =>
      JSON.stringify({
        name,
        brief: brief.slice(0, 200),
        at,
        words: wordsFor?.get(name),
      } satisfies HistoryLine),
    )
    .join('\n');

  try {
    await mkdir(dirname(HISTORY_PATH), { recursive: true });
    await appendFile(HISTORY_PATH, `${lines}\n`, 'utf8');
    const seen = await loadSeen();
    for (const name of fresh) seen.add(name);
    const usage = await loadWordUsage();
    for (const name of fresh) {
      for (const word of wordsFor?.get(name) ?? []) {
        usage.set(word, (usage.get(word) ?? 0) + 1);
      }
    }
  } catch {
    // A history we cannot write is not a reason to fail a run.
  }
}

export async function forgetSeen(): Promise<void> {
  cache = undefined;
  wordCache = undefined;
  await rm(HISTORY_PATH, { force: true });
}

export function historyPath(): string {
  return HISTORY_PATH;
}

export async function seenCount(): Promise<number> {
  return (await loadSeen()).size;
}
