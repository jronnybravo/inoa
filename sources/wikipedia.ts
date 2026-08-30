/**
 * Wikipedia source.
 *
 * Two roles. Forward: mine mythology, astronomy and geography for concepts the
 * curated bank does not contain. Backward: tell us what a finished candidate
 * already means in the world — a name with a famous article attached is not
 * blank space, and that is a positioning risk before it is a legal one.
 */

import { getJSON } from '../core/net.ts';
import { normalize } from '../core/text.ts';
import type { ConceptDomain, Seed } from '../core/types.ts';

interface SearchResponse {
  query?: { search?: { title: string; snippet: string }[] };
}

interface SummaryResponse {
  title?: string;
  extract?: string;
  type?: string;
  description?: string;
}

const API = 'https://en.wikipedia.org/w/api.php';

export async function searchTitles(query: string, limit = 12): Promise<{ title: string; snippet: string }[]> {
  const url = `${API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&formatversion=2`;
  const data = await getJSON<SearchResponse>(url, { cacheFailures: true });
  return (data?.query?.search ?? []).map((r) => ({
    title: r.title,
    snippet: r.snippet.replace(/<[^>]*>/g, ''),
  }));
}

export async function summary(title: string): Promise<SummaryResponse | undefined> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  return getJSON<SummaryResponse>(url, { cacheFailures: true });
}

/**
 * What does this name already mean? Used as a risk signal on finalists.
 * Returns undefined when the name is blank space — which is what we want.
 */
export async function existingMeaning(
  name: string,
): Promise<{ title: string; description: string; disambiguation: boolean } | undefined> {
  const s = await summary(name);
  if (!s?.title || !s.extract) return undefined;
  if (normalize(s.title) !== normalize(name)) return undefined;
  return {
    title: s.title,
    description: s.description ?? s.extract.slice(0, 160),
    disambiguation: s.type === 'disambiguation',
  };
}

/** One-word article titles from a domain — a rich vein of symbolic names. */
export async function mineDomain(
  query: string,
  domain: ConceptDomain,
  tags: string[],
  limit = 12,
): Promise<Seed[]> {
  const results = await searchTitles(query, limit);
  const seeds: Seed[] = [];
  for (const r of results) {
    // Single-word titles only: 'Halcyon' is a name, 'Halcyon days (mythology)' is not.
    if (/[\s(,]/.test(r.title)) continue;
    const form = normalize(r.title);
    if (form.length < 4 || form.length > 11) continue;
    seeds.push({
      form,
      gloss: r.snippet.slice(0, 120),
      language: 'english',
      source: 'wikipedia',
      domain,
      tags,
      weight: 0.6,
      note: `wikipedia: ${r.title}`,
    });
  }
  return seeds;
}
