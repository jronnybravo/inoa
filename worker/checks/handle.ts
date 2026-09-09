/**
 * Whether a name is free as a handle on a social platform.
 *
 * Three ways of asking, because platforms answer three different ways:
 *
 *   a status code   the profile URL 404s for a handle nobody holds
 *   an API          a public endpoint says whether the account resolves
 *   a page marker   the HTML says which of two pages it is serving
 *
 * The first is the cleanest and the rarest. Most platforms stopped serving
 * profiles as plain documents years ago and answer 200 to everything, which
 * is why an earlier version of this file could only check three of them — it
 * was asking every platform the one question only three could answer.
 *
 * A marker is the weakest of the three and is treated as such: anything that
 * does not match a shape this file recognises comes back 'unknown' rather
 * than being read as free. A page that has been redesigned should stop
 * answering, not start lying.
 *
 * Unlike a domain, every handle check reaches the same host, so each platform
 * queues against its own limiter — see pipeline.ts.
 */

import { asHandle, platform } from '../../src/lib/handles.ts';
import { type CheckOutcome } from './shared.ts';

const BROWSER_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TIMEOUT = 12_000;

/**
 * Statuses that mean the platform declined to answer rather than answered.
 *
 * Kept apart from 404 on purpose. A 429 is 'ask me later' and a 403 is 'not
 * like this'; reading either as 'nobody has this handle' would hand back a
 * free verdict on a name somebody is already using.
 */
const NO_ANSWER = new Set([401, 403, 405, 429, 451, 500, 502, 503, 504]);

const get = (url: string, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': BROWSER_UA, ...headers },
        signal: AbortSignal.timeout(TIMEOUT)
    });

type Ask = (handle: string, label: string) => Promise<CheckOutcome>;

/**
 * The plain case: the profile URL 404s when the handle is free.
 *
 * Substack is the odd one, using a subdomain rather than a path, which the
 * url function in $lib/handles already accounts for.
 */
function byStatus(url: (handle: string) => string): Ask {
    return async (handle, label) => {
        const response = await get(url(handle));
        if (response.status === 404) {
            return { status: 'clear', detail: `@${handle} is free on ${label}` };
        }
        if (response.ok) {
            return { status: 'taken', detail: `${url(handle)} exists` };
        }
        return {
            status: 'unknown',
            detail: `${label} answered ${response.status}${
                NO_ANSWER.has(response.status) ? ' rather than answering' : ''
            }`
        };
    };
}

/**
 * Bluesky publishes identity resolution, which is exactly this question.
 *
 * A 400 'Unable to resolve handle' is a definite no rather than a failure,
 * which is why it is read as clear where a 400 elsewhere would not be.
 */
const askBluesky: Ask = async (handle, label) => {
    const url =
        'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle' +
        `?handle=${handle}.bsky.social`;
    const response = await get(url);
    if (response.ok) {
        return { status: 'taken', detail: `@${handle}.bsky.social resolves` };
    }
    if (response.status === 400) {
        return { status: 'clear', detail: `@${handle}.bsky.social does not resolve` };
    }
    return { status: 'unknown', detail: `${label} answered ${response.status}` };
};

/**
 * Twitch answers properly if asked through the endpoint its own web client
 * uses. The client id is the public one every browser session sends.
 */
const askTwitch: Ask = async (handle, label) => {
    const response = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
            'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
            'content-type': 'application/json',
            'user-agent': BROWSER_UA
        },
        body: JSON.stringify([{ query: `{user(login:"${handle}"){id}}` }]),
        signal: AbortSignal.timeout(TIMEOUT)
    });
    if (!response.ok) {
        return { status: 'unknown', detail: `${label} answered ${response.status}` };
    }
    const body = (await response.json()) as { data?: { user?: { id?: string } | null } }[];
    const user = body[0]?.data?.user;
    if (user === null) {
        return { status: 'clear', detail: `@${handle} is free on ${label}` };
    }
    if (user?.id) {
        return { status: 'taken', detail: `twitch.tv/${handle} exists` };
    }
    return { status: 'unknown', detail: `${label} returned a shape this does not recognise` };
};

/**
 * Telegram serves one of two pages and says which in its title: 'View @name'
 * or 'Launch @name' for something that exists, 'Contact @name' for an invite
 * to a handle nobody holds.
 *
 * The weakest signal here, so it is the strictest reader: only those exact
 * shapes are answers, and anything else is 'unknown'.
 */
const askTelegram: Ask = async (handle, label) => {
    const response = await get(`https://t.me/${handle}`);
    if (!response.ok) {
        return { status: 'unknown', detail: `${label} answered ${response.status}` };
    }
    const title = /<title>([^<]*)<\/title>/.exec(await response.text())?.[1] ?? '';
    if (title.startsWith('Telegram: Contact')) {
        return { status: 'clear', detail: `@${handle} is free on ${label}` };
    }
    if (/^Telegram: (View|Launch)/.test(title)) {
        return { status: 'taken', detail: `t.me/${handle} exists` };
    }
    return { status: 'unknown', detail: `${label} served a page this does not recognise` };
};

/**
 * Pinterest answers 200 either way, but titles a real profile and leaves the
 * title empty on a page for a handle nobody holds.
 *
 * The most fragile check in the file: an empty title is the absence of a
 * signal rather than a signal, so it is only trusted when the page is
 * otherwise the shape expected.
 */
const askPinterest: Ask = async (handle, label) => {
    const response = await get(`https://www.pinterest.com/${handle}/`);
    if (!response.ok) {
        return { status: 'unknown', detail: `${label} answered ${response.status}` };
    }
    const html = await response.text();
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() ?? '';
    if (title === '') {
        return { status: 'clear', detail: `@${handle} is free on ${label}` };
    }
    if (title.toLowerCase().includes(handle)) {
        return { status: 'taken', detail: `pinterest.com/${handle} exists` };
    }
    return { status: 'unknown', detail: `${label} served a page this does not recognise` };
};

/**
 * The crawler user agent every platform keeps a door open for.
 *
 * Instagram, Facebook and TikTok all refuse a plain request and all still
 * publish a link preview, because they want their own links to look right in
 * everybody else's app. Asking as the thing that renders those previews is
 * asking the question they are still willing to answer.
 */
const PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const titleOf = (html: string): string =>
    (/<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1] ?? '').trim();

/**
 * A page whose title is the platform's own name and nothing else.
 *
 * Instagram titles a real profile 'NASA (@nasa) • Instagram photos…' and a
 * handle nobody holds just 'Instagram'; Facebook does the same with the page
 * name. Two positive shapes rather than one signal and its absence, so a page
 * that is neither can say so.
 *
 * An unrecognised page reads as taken rather than free. That is the
 * conservative direction on purpose: a wrong 'taken' costs a good name, a
 * wrong 'free' ships a brand somebody else owns.
 */
function byBareTitle(url: (handle: string) => string, bare: string): Ask {
    return async (handle, label) => {
        const response = await get(url(handle), { 'user-agent': PREVIEW_UA });
        if (!response.ok) {
            return { status: 'unknown', detail: `${label} answered ${response.status}` };
        }
        const title = titleOf(await response.text());
        if (title === '') {
            return { status: 'unknown', detail: `${label} served a page with no title` };
        }
        if (title === bare) {
            return { status: 'clear', detail: `@${handle} is free on ${label}` };
        }
        return { status: 'taken', detail: `${label}: ${title.slice(0, 70)}` };
    };
}

/**
 * TikTok publishes oEmbed, which is a documented endpoint meant for exactly
 * this: hand it a profile URL and it describes the profile, or refuses.
 */
const askTikTok: Ask = async (handle, label) => {
    const url =
        'https://www.tiktok.com/oembed?url=' +
        encodeURIComponent(`https://www.tiktok.com/@${handle}`);
    const response = await get(url);
    if (response.ok) {
        const body = (await response.json()) as { author_name?: string };
        return {
            status: 'taken',
            detail: `tiktok.com/@${handle} — ${body.author_name ?? 'exists'}`
        };
    }
    if (response.status === 400) {
        return { status: 'clear', detail: `@${handle} is free on ${label}` };
    }
    return { status: 'unknown', detail: `${label} answered ${response.status}` };
};

const ASK: Record<string, Ask> = {
    instagram: byBareTitle((h) => `https://www.instagram.com/${h}/`, 'Instagram'),
    facebook: byBareTitle((h) => `https://www.facebook.com/${h}`, 'Facebook'),
    tiktok: askTikTok,
    x: byStatus((h) => `https://x.com/${h}`),
    github: byStatus((h) => `https://github.com/${h}`),
    youtube: byStatus((h) => `https://www.youtube.com/@${h}`),
    substack: byStatus((h) => `https://${h}.substack.com`),
    soundcloud: byStatus((h) => `https://soundcloud.com/${h}`),
    vimeo: byStatus((h) => `https://vimeo.com/${h}`),
    bluesky: askBluesky,
    twitch: askTwitch,
    telegram: askTelegram,
    pinterest: askPinterest
};

export async function checkHandle(name: string, platformId: string): Promise<CheckOutcome> {
    const site = platform(platformId);
    const ask = ASK[platformId];
    if (!site || !ask) {
        return { status: 'unknown', detail: `${platformId} is not a platform this can check` };
    }

    const handle = asHandle(name);
    try {
        return await ask(handle, site.label);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { status: 'unknown', detail: `${site.label} could not be reached — ${reason}` };
    }
}
