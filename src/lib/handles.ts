/**
 * The social platforms a name can be checked on.
 *
 * Every entry here was probed both ways — a handle somebody holds and a
 * handle nobody could — before being added, and each answers definitively
 * rather than plausibly. How each one answers differs, and that detail lives
 * in worker/checks/handle.ts; this module is the part the browser needs.
 *
 * The list was three long when it only asked for a profile page and read the
 * status code. Most platforms stopped serving profiles that way years ago, so
 * asking the page was asking the wrong thing: Bluesky has a public identity
 * API, Twitch has a public GraphQL endpoint, and Telegram says which of two
 * pages it is serving in its own title. Seven more platforms answer once you
 * ask them the way they expect to be asked.
 *
 * Instagram, Facebook and TikTok were the last three to fall and the three
 * that matter most. None answers a plain request: Instagram's web API wants a
 * login, TikTok serves a 1.4KB bot wall, Facebook redirects. All three still
 * publish a link preview, because they want their own links to look good in
 * everybody else's app — and a link preview for a profile that does not exist
 * is exactly the signal being looked for.
 *
 * Still out, and now genuinely rather than for want of trying: Reddit is 403
 * without a token on both www and old, Medium sits behind Cloudflare, and
 * LinkedIn blocks outright. A checker for those could only guess, and a guess
 * dressed as a verdict is the failure this project is built around.
 */

export interface Platform {
    id: string;
    label: string;
    /** Where a person goes to look for themselves. */
    url: (handle: string) => string;
    /**
     * Approximate monthly active users, in millions.
     *
     * Widely reported figures as of early 2026, rounded hard on purpose. They
     * exist to order the list, not to be quoted: the gap between Facebook and
     * Substack is the real information here, and the gap between Twitch and
     * Vimeo is not. Neighbours within the same order of magnitude should be
     * read as 'about the same size', because that is all this claims.
     *
     * Unlike the TLD list, there is no free feed of these to generate from, so
     * they are written down rather than fetched — and will drift.
     */
    users: number;
}

/**
 * Every platform that answers, most used first.
 *
 * Sorted rather than hand-ordered, so adding one puts it where its size says
 * it belongs instead of wherever it was typed. Somebody naming a company
 * reaches for the biggest first and searches for the rest, which is the same
 * shape as the domain list beside it.
 */
const KNOWN: Platform[] = [
    { id: 'facebook', label: 'Facebook', url: (h) => `https://www.facebook.com/${h}`, users: 3000 },
    { id: 'youtube', label: 'YouTube', url: (h) => `https://www.youtube.com/@${h}`, users: 2500 },
    {
        id: 'instagram',
        label: 'Instagram',
        url: (h) => `https://www.instagram.com/${h}/`,
        users: 2000
    },
    { id: 'tiktok', label: 'TikTok', url: (h) => `https://www.tiktok.com/@${h}`, users: 1600 },
    { id: 'telegram', label: 'Telegram', url: (h) => `https://t.me/${h}`, users: 950 },
    { id: 'x', label: 'X', url: (h) => `https://x.com/${h}`, users: 600 },
    {
        id: 'pinterest',
        label: 'Pinterest',
        url: (h) => `https://www.pinterest.com/${h}/`,
        users: 550
    },
    { id: 'twitch', label: 'Twitch', url: (h) => `https://www.twitch.tv/${h}`, users: 240 },
    { id: 'vimeo', label: 'Vimeo', url: (h) => `https://vimeo.com/${h}`, users: 150 },
    { id: 'github', label: 'GitHub', url: (h) => `https://github.com/${h}`, users: 150 },
    {
        id: 'soundcloud',
        label: 'SoundCloud',
        url: (h) => `https://soundcloud.com/${h}`,
        users: 130
    },
    { id: 'substack', label: 'Substack', url: (h) => `https://${h}.substack.com`, users: 35 },
    {
        id: 'bluesky',
        label: 'Bluesky',
        url: (h) => `https://bsky.app/profile/${h}.bsky.social`,
        users: 35
    }
];

// Sorted here rather than by hand above, so a new entry lands where its size
// puts it instead of wherever it was typed.
export const PLATFORMS: readonly Platform[] = [...KNOWN].sort(
    (a, b) => b.users - a.users || a.label.localeCompare(b.label)
);

/**
 * What a run checks unless somebody says otherwise.
 *
 * The three a brand is asked about first. They are also three of the four that
 * took the most work to check at all — see worker/checks/handle.ts.
 */
const DEFAULTS = new Set(['instagram', 'facebook', 'tiktok']);

/**
 * Derived from the sorted list rather than written in an order of its own, so
 * the default pills come out most-used-first like everything else. Written by
 * hand it read Instagram, Facebook, TikTok — which is not the order of
 * anything.
 */
export const DEFAULT_PLATFORMS = PLATFORMS.filter((p) => DEFAULTS.has(p.id)).map((p) => p.id);

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

export const platform = (id: string): Platform | undefined => BY_ID.get(id);

export const isPlatform = (id: string): boolean => BY_ID.has(id);

/**
 * A name as a handle.
 *
 * The same squashing the domain check uses, and for the same reason: nobody
 * registers 'Farm Well', they register 'farmwell'.
 */
export const asHandle = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
