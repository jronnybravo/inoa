/**
 * Trademark risk estimation.
 *
 * Read this section honestly: there is no free, unauthenticated, machine-
 * readable trademark register covering the jurisdictions that matter, and the
 * local corpus of well-known marks has been removed. Without a register API
 * configured, the only signal left is whether Wikipedia says the name already
 * denotes something specific.
 *
 * That means NOTHING here checks a candidate against existing trademarks. The
 * score is a weak notability proxy, not a clearance search and not legal
 * advice. Every finalist needs a real search by a trademark attorney.
 *
 * If you have access to a register API, set BRANDY_TRADEMARK_API to a URL
 * template containing {name} and the results are used instead, with
 * `authoritative` set to true.
 */

import { getJSON } from '../core/net.ts';
import { existingMeaning } from '../sources/wikipedia.ts';
import { clamp, editSimilarity, jaroWinkler, normalize, phoneticSimilarity } from '../core/text.ts';
import type { TrademarkCheck } from '../core/types.ts';

/** Sectors that examiners routinely treat as related for confusion purposes. */
const RELATED_SECTORS: Record<string, string[]> = {
  tech: ['ai', 'dev', 'data', 'infra', 'security', 'productivity', 'devops'],
  ai: ['tech', 'dev', 'data'],
  fintech: ['finance', 'crypto', 'insurance'],
  finance: ['fintech', 'crypto', 'insurance'],
  health: ['pharma', 'bio', 'wellness', 'fitness'],
  media: ['social', 'games', 'audio'],
  retail: ['delivery', 'apparel', 'food'],
};

function sectorsOverlap(brandSectors: string[], industry: string): boolean {
  if (!industry) return false;
  const target = industry.toLowerCase();
  return brandSectors.some(
    (s) => s === target || (RELATED_SECTORS[s] ?? []).includes(target) || target.includes(s),
  );
}

interface ProviderMark {
  name?: string;
  mark?: string;
  wordmark?: string;
  keyword?: string;
  status?: string;
}

/** Optional real-register lookup. */
async function providerSearch(name: string): Promise<{ marks: string[] } | undefined> {
  const template = process.env.BRANDY_TRADEMARK_API;
  if (!template) return undefined;
  const url = template.replace('{name}', encodeURIComponent(name));
  const key = process.env.BRANDY_TRADEMARK_API_KEY;
  const data = await getJSON<ProviderMark[] | { items?: ProviderMark[]; marks?: ProviderMark[] }>(
    url,
    {
      timeoutMs: 9000,
      headers: key ? { authorization: `Bearer ${key}`, 'x-api-key': key } : undefined,
    },
  );
  if (!data) return undefined;
  const rows = Array.isArray(data) ? data : data.items ?? data.marks ?? [];
  const marks = rows
    .map((r) => r.name ?? r.mark ?? r.wordmark ?? r.keyword)
    .filter((m): m is string => Boolean(m));
  return { marks };
}

export async function checkTrademark(
  name: string,
  industry = '',
  useWikipedia = true,
): Promise<TrademarkCheck> {
  const w = normalize(name);
  const collisions: TrademarkCheck['collisions'] = [];
  let score = 88;

  const provider = await providerSearch(w);
  const marks = provider
    ? provider.marks.map((m) => ({ name: m, sectors: [] as string[], fame: 'known' as const }))
    : [];

  for (const brand of marks) {
    const mark = normalize(brand.name);
    if (!mark || mark.length < 3) continue;
    const sight = jaroWinkler(w, mark) * 0.95;
    const sound = phoneticSimilarity(w, mark);
    const similarity = Math.max(sight, sound);
    if (similarity < 0.84 || editSimilarity(w, mark) < 0.55) continue;

    const sameField = sectorsOverlap(brand.sectors, industry);
    // Sight, sound and relatedness are the factors that decide these cases.
    score -= (similarity - 0.75) * 200 * (sameField ? 1.6 : 1);

    collisions.push({
      mark: brand.name,
      similarity: Math.round(similarity * 100) / 100,
      reason: [
        sound > sight ? 'similar in sound' : 'similar in appearance',
        sameField ? `and operates in a related field (${brand.sectors.join('/')})` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
  }

  // With no local corpus, this is the only signal left without a register API:
  // a name that already denotes something specific in the world is harder to
  // own and harder to rank for.
  if (useWikipedia && collisions.length === 0) {
    const meaning = await existingMeaning(name);
    if (meaning && !meaning.disambiguation) {
      score -= 12;
      collisions.push({
        mark: meaning.title,
        similarity: 1,
        reason: `already denotes something specific: ${meaning.description}`,
      });
    }
  }

  return {
    uniqueness: clamp(score),
    collisions: collisions.sort((a, b) => b.similarity - a.similarity).slice(0, 5),
    method: provider ? 'register api' : 'wikipedia notability only — no mark corpus',
    authoritative: Boolean(provider),
  };
}

/** Where a human should go to actually clear the name. */
export function clearanceLinks(name: string): { registry: string; url: string }[] {
  const q = encodeURIComponent(name);
  return [
    { registry: 'USPTO (US)', url: `https://tmsearch.uspto.gov/search/search-information?q=${q}` },
    { registry: 'EUIPO (EU)', url: `https://www.tmdn.org/tmview/#/tmview/results?basicSearch=${q}` },
    { registry: 'WIPO Global Brand DB', url: `https://branddb.wipo.int/en/quicksearch?q=${q}` },
    { registry: 'UKIPO (UK)', url: `https://trademarks.ipo.gov.uk/ipo-tmtext?searchTerm=${q}` },
  ];
}
