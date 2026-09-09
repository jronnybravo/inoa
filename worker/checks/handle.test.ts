/**
 * Reading a platform's answer about a handle.
 *
 * Ten platforms answering four different ways, and the thing worth pinning is
 * not that a 404 means free — it is everything that must NOT mean free. A
 * rate limit, a login wall, a redesigned page, a shape nobody recognises: all
 * of those are 'we could not find out', and any one of them read as 'nobody
 * has this' ships a brand somebody else owns.
 *
 * Nothing here touches the network. Every case answers from a stubbed fetch,
 * so the tests describe how a reply is interpreted rather than what a platform
 * happened to say today.
 *
 *   node --test --experimental-strip-types worker/checks/handle.test.ts
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { PLATFORMS } from '../../src/lib/handles.ts';
import { checkHandle } from './handle.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

/** Every request answers the same way, and the URLs asked for are recorded. */
function answering(reply: { status?: number; body?: string; json?: unknown }) {
    const asked: string[] = [];
    globalThis.fetch = ((url: string | URL) => {
        asked.push(url.toString());
        const status = reply.status ?? 200;
        const body = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.body ?? '');
        return Promise.resolve(
            new Response(body, { status, headers: { 'content-type': 'application/json' } })
        );
    }) as typeof fetch;
    return { asked };
}

const page = (title: string): string => `<html><head><title>${title}</title></head><body></body>`;

describe('platforms that answer with a status code', () => {
    const byStatus = ['x', 'github', 'youtube', 'substack', 'soundcloud', 'vimeo'];

    for (const id of byStatus) {
        it(`${id}: 404 is free`, async () => {
            answering({ status: 404 });
            const out = await checkHandle('Brivos', id);
            assert.equal(out.status, 'clear');
        });

        it(`${id}: 200 is taken`, async () => {
            answering({ status: 200, body: page('anything') });
            assert.equal((await checkHandle('Brivos', id)).status, 'taken');
        });
    }

    /*
     * The distinction the whole project turns on. A 429 is 'ask me later' and
     * a 403 is 'not like this'; reading either as 'nobody has this handle'
     * hands back a free verdict on a name somebody is already using.
     */
    for (const status of [401, 403, 429, 451, 500, 503]) {
        it(`github: ${status} is unknown, never free`, async () => {
            answering({ status });
            const out = await checkHandle('Brivos', 'github');
            assert.equal(out.status, 'unknown');
            assert.match(out.detail ?? '', /\d{3}/, 'the detail says what was answered');
        });
    }
});

describe('bluesky, which publishes identity resolution', () => {
    it('reads a resolved handle as taken', async () => {
        answering({ status: 200, json: { did: 'did:plc:abc' } });
        assert.equal((await checkHandle('Stripe', 'bluesky')).status, 'taken');
    });

    /*
     * 400 is a definite no here rather than a failure, which is why it reads
     * as clear where a 400 anywhere else in this file would not.
     */
    it('reads a 400 as free, because that is what it means here', async () => {
        answering({ status: 400, json: { error: 'InvalidRequest' } });
        assert.equal((await checkHandle('Brivos', 'bluesky')).status, 'clear');
    });

    it('still refuses to guess on anything else', async () => {
        answering({ status: 503 });
        assert.equal((await checkHandle('Brivos', 'bluesky')).status, 'unknown');
    });

    it('asks about the handle under bsky.social', async () => {
        const { asked } = answering({ status: 400 });
        await checkHandle('Farm Well', 'bluesky');
        assert.match(asked[0] ?? '', /handle=farmwell\.bsky\.social/);
    });
});

describe('twitch, through its public graph', () => {
    it('reads a null user as free', async () => {
        answering({ status: 200, json: [{ data: { user: null } }] });
        assert.equal((await checkHandle('Brivos', 'twitch')).status, 'clear');
    });

    it('reads a user with an id as taken', async () => {
        answering({ status: 200, json: [{ data: { user: { id: '12826' } } }] });
        assert.equal((await checkHandle('Twitch', 'twitch')).status, 'taken');
    });

    /* A shape this does not recognise is not an answer. */
    it('refuses a reply it cannot read', async () => {
        answering({ status: 200, json: [{ errors: [{ message: 'nope' }] }] });
        assert.equal((await checkHandle('Brivos', 'twitch')).status, 'unknown');
    });
});

describe('telegram, which says which page it is serving', () => {
    it('reads Contact as free', async () => {
        answering({ body: page('Telegram: Contact @brivos') });
        assert.equal((await checkHandle('Brivos', 'telegram')).status, 'clear');
    });

    for (const word of ['View', 'Launch']) {
        it(`reads ${word} as taken`, async () => {
            answering({ body: page(`Telegram: ${word} @stripe`) });
            assert.equal((await checkHandle('Stripe', 'telegram')).status, 'taken');
        });
    }

    /*
     * The strictness is the point: a marker is the weakest signal here, so a
     * page that has been redesigned should stop answering rather than start
     * lying.
     */
    it('refuses a title it does not recognise', async () => {
        answering({ body: page('Telegram') });
        assert.equal((await checkHandle('Brivos', 'telegram')).status, 'unknown');
    });
});

describe('instagram and facebook, through the link preview', () => {
    it('reads the bare platform name as free', async () => {
        answering({ body: page('Instagram') });
        assert.equal((await checkHandle('Brivos', 'instagram')).status, 'clear');
        answering({ body: page('Facebook') });
        assert.equal((await checkHandle('Brivos', 'facebook')).status, 'clear');
    });

    it('reads a titled profile as taken', async () => {
        answering({ body: page('NASA (@nasa) • Instagram photos and videos') });
        assert.equal((await checkHandle('NASA', 'instagram')).status, 'taken');
    });

    /*
     * An unrecognised page reads as taken on purpose. A wrong 'taken' costs a
     * good name; a wrong 'free' ships a brand somebody else owns.
     */
    it('errs towards taken when the page has a title it cannot place', async () => {
        answering({ body: page('Log in to Facebook') });
        assert.equal((await checkHandle('Brivos', 'facebook')).status, 'taken');
    });

    it('says unknown when there is no title at all', async () => {
        answering({ body: '<html><body>nothing</body></html>' });
        assert.equal((await checkHandle('Brivos', 'instagram')).status, 'unknown');
    });

    it('asks as the crawler these platforms still answer', async () => {
        let sent: Record<string, string> = {};
        globalThis.fetch = ((_u: string, init?: RequestInit) => {
            sent = (init?.headers ?? {}) as Record<string, string>;
            return Promise.resolve(new Response(page('Instagram'), { status: 200 }));
        }) as typeof fetch;
        await checkHandle('Brivos', 'instagram');
        assert.match(sent['user-agent'] ?? '', /facebookexternalhit/);
    });
});

describe('tiktok, through its documented oembed', () => {
    it('reads a described profile as taken', async () => {
        answering({ status: 200, json: { author_name: 'TikTok' } });
        const out = await checkHandle('TikTok', 'tiktok');
        assert.equal(out.status, 'taken');
        assert.match(out.detail ?? '', /TikTok/);
    });

    it('reads its 400 as free', async () => {
        answering({ status: 400, json: { message: 'Something went wrong' } });
        assert.equal((await checkHandle('Brivos', 'tiktok')).status, 'clear');
    });
});

describe('whatever else happens', () => {
    it('never guesses about a platform it does not know', async () => {
        const out = await checkHandle('Brivos', 'myspace');
        assert.equal(out.status, 'unknown');
        assert.match(out.detail ?? '', /not a platform/);
    });

    it('reads a network failure as unknown rather than free', async () => {
        globalThis.fetch = () => Promise.reject(new Error('ENOTFOUND'));
        const out = await checkHandle('Brivos', 'github');
        assert.equal(out.status, 'unknown');
        assert.match(out.detail ?? '', /ENOTFOUND/);
    });

    it('squashes a name into a handle before asking', async () => {
        const { asked } = answering({ status: 404 });
        await checkHandle('Farm Well!', 'github');
        assert.match(asked[0] ?? '', /github\.com\/farmwell$/);
    });

    /* Every platform in the list has to be answerable, or the form offers a
     * check that always comes back unknown. */
    it('has a way of asking every platform it offers', async () => {
        for (const p of PLATFORMS) {
            answering({ status: 404, json: { error: 'x' }, body: page('Telegram: Contact @x') });
            const out = await checkHandle('Brivos', p.id);
            assert.notEqual(
                out.detail,
                `${p.id} is not a platform this can check`,
                `${p.label} is offered but has no checker`
            );
        }
    });
});
