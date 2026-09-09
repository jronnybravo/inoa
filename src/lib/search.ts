/**
 * Whether anything can answer the web check quickly.
 *
 * The names are here rather than in worker/checks/web.ts because the form has
 * to know the answer too, and that module pulls in cheerio and — a little
 * further down — Playwright. A page asking 'is a search provider configured?'
 * should not drag a browser into the bundle to find out.
 *
 * web.ts imports this, so there is still one list.
 */
export const SEARCH_KEYS = [
    'TAVILY_API_KEY',
    'FIRECRAWL_API_KEY',
    'SERPER_API_KEY',
    'EXA_API_KEY',
    'BRAVE_API_KEY'
] as const;

/** Read at call time, so a key exported after import is still seen. */
export function searchConfigured(): boolean {
    return SEARCH_KEYS.some((key) => Boolean(process.env[key]));
}
