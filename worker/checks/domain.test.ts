/**
 * The .com check, pinned against the ways it used to be wrong.
 *
 * Every case here is a fact about someone else's server, so the decision is
 * tested apart from the fetch that gathers it: readPage takes the response we
 * got, readFailure takes the error we got instead, and neither touches the
 * network. That is what makes the regressions cheap to state.
 *
 * Two of these are transcripts of real measurements. linear.com answers 403 to
 * this user agent and asana.com carries a "Coming soon" product badge in its
 * navigation — both were reported free, and both now have a test.
 *
 *   node --test --experimental-strip-types worker/checks/*.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    classifyDelegation,
    classifyNameservers,
    offeredForSale,
    readFailure,
    readPage,
    visibleText,
    type PageEvidence
} from './domain.ts';

const DOMAIN = 'example.com';

const served = (html: string, over: Partial<PageEvidence> = {}): PageEvidence => ({
    status: 200,
    ok: true,
    html,
    ...over
});

/** Comfortably past the holding-page threshold, so the page speaks for itself. */
const prose = (extra = ''): string =>
    `<body><main><p>${'We build scheduling software for service teams. '.repeat(15)}</p>` +
    `${extra}</main></body>`;

function transportError(code?: string): TypeError {
    const error = new TypeError('fetch failed');
    if (code !== undefined) {
        error.cause = Object.assign(new Error('transport failure'), { code });
    }
    return error;
}

describe('visibleText', () => {
    it('drops the contents of script and style, not just their tags', () => {
        const html = `<body><script>var msg = "coming soon";</script>
            <style>.a { content: "under construction"; }</style><p>Hello</p></body>`;
        const text = visibleText(html);
        assert.equal(text, 'Hello');
        assert.doesNotMatch(text, /coming soon|under construction/);
    });

    it('drops comments and head, and collapses whitespace', () => {
        const html = '<head><title>Ignored</title></head><!-- note --><p>A  \n  B</p>';
        assert.equal(visibleText(html), 'A B');
    });

    it('counts only rendered prose towards length, so a bundle is not content', () => {
        const bundle = `<body><div id="root"></div><script>${'x'.repeat(5000)}</script></body>`;
        assert.ok(visibleText(bundle).length < 400);
    });
});

describe('readPage — what a status establishes', () => {
    for (const status of [404, 410]) {
        it(`clears on ${status}, which is a statement that nothing is published`, () => {
            const outcome = readPage(DOMAIN, served('', { status, ok: false }));
            assert.equal(outcome.status, 'clear');
        });
    }

    /*
     * linear.com: ordinary bot protection, which the first version of this
     * check reported as free. A refusal is not an absence — but it is not
     * nothing either. Something understood the request and declined it, and
     * nobody puts a WAF, an auth wall or a rate limiter in front of a name
     * they are not using.
     */
    for (const status of [401, 402, 403, 405, 406, 429, 451]) {
        it(`reads a ${status} as a deployment: a server is there, refusing us`, () => {
            const outcome = readPage(DOMAIN, served('', { status, ok: false }));
            assert.equal(outcome.status, 'taken');
            assert.match(outcome.detail ?? '', new RegExp(String(status)));
        });
    }

    /*
     * 5xx stays undecided, and the distinction is the whole point of keeping
     * two categories. A 502 from a CDN with a dead origin and a 503 from a
     * host somebody stopped paying for are indistinguishable from outside, and
     * the second is a name that may well be available.
     */
    for (const status of [500, 502, 503, 504]) {
        it(`cannot judge a ${status}: a broken host is not an occupied one`, () => {
            const outcome = readPage(DOMAIN, served('', { status, ok: false }));
            assert.equal(outcome.status, 'unknown');
            assert.match(outcome.detail ?? '', new RegExp(String(status)));
        });
    }
});

describe('readPage — parked and holding pages', () => {
    for (const phrase of [
        'This domain is parked',
        'Buy this domain',
        'Courtesy of GoDaddy',
        'Welcome to nginx!',
        'Apache2 Ubuntu Default Page'
    ]) {
        it(`clears on "${phrase}", which nobody writes about their own business`, () => {
            const outcome = readPage(DOMAIN, served(`<body><h1>${phrase}</h1></body>`));
            assert.equal(outcome.status, 'clear');
        });
    }

    it('clears a registrar page however much boilerplate it carries', () => {
        const html = prose(
            '<footer>This domain is for sale. Checkout the full domain details</footer>'
        );
        assert.equal(readPage(DOMAIN, served(html)).status, 'clear');
    });

    it('clears "coming soon" when it is substantially the whole page', () => {
        const outcome = readPage(DOMAIN, served('<body><h1>Coming soon</h1></body>'));
        assert.equal(outcome.status, 'clear');
    });

    /*
     * asana.com. A "Coming soon" badge on one product in a navigation flyout
     * cleared a live company, because the phrase was matched against the whole
     * raw document. On a page this size the phrase means nothing.
     */
    it('does not clear "coming soon" as a badge on a live marketing site', () => {
        const nav = '<nav><a>For service teams<span class="tag">Coming soon</span></a></nav>';
        const outcome = readPage(DOMAIN, served(prose(nav)));
        assert.equal(outcome.status, 'taken');
    });

    it('does not clear a parked phrase that only appears inside a script', () => {
        const script = '<script>const banner = "this domain is for sale";</script>';
        assert.equal(readPage(DOMAIN, served(prose(script))).status, 'taken');
    });
});

describe('readPage — pages too thin to judge', () => {
    it('cannot judge a client-rendered shell, rather than calling it free', () => {
        const shell = '<body><div id="root"></div><script src="/app.js"></script></body>';
        const outcome = readPage(DOMAIN, served(shell));
        assert.equal(outcome.status, 'unknown');
    });

    it('cannot judge a page whose only prose is a one-line notice', () => {
        const stub = '<body><p>This site is being rebuilt. Mail hello@example.com.</p></body>';
        assert.equal(readPage(DOMAIN, served(stub)).status, 'unknown');
    });

    /*
     * airbnb.com. A 599 KB document that renders 375 characters, every one of
     * them navigation naming the brand. It is short, but somebody built it —
     * and the old 400-character line, recalibrated once scripts stopped
     * counting as prose, would have read it as an empty lot.
     */
    it('reads navigation-length prose as a site somebody built', () => {
        const nav =
            '<body><a>Skip to content</a><nav>Airbnb homepage All Homes Homes ' +
            'Experiences Experiences Services Services Where When Add dates Who ' +
            'Add guests Log in or sign up Help Center Become a host</nav></body>';
        const outcome = readPage(DOMAIN, served(nav));
        assert.equal(outcome.status, 'taken');
    });

    it('reads a page with real content as taken', () => {
        assert.equal(readPage(DOMAIN, served(prose())).status, 'taken');
    });

    it('names the redirect target, since that is who the domain belongs to', () => {
        const outcome = readPage(DOMAIN, served(prose(), { finalUrl: 'https://acme.io' }));
        assert.equal(outcome.status, 'taken');
        assert.match(outcome.detail ?? '', /acme\.io/);
    });
});

/**
 * The delegation, for pages the body could not settle.
 *
 * A holding page and a client-rendered app are the same few bytes over HTTP,
 * and no threshold on page length separates them — which is why 49 of this
 * project's 69 remaining unverified .com cells sit in exactly that band. DNS
 * answers the one question the body cannot: a domain delegated to a parking
 * service is inventory, not a business.
 */
describe('classifyNameservers', () => {
    for (const host of [
        'ns1.sedoparking.com',
        'NS2.BODIS.COM',
        'ns1.parkingcrew.net',
        'ns1.above.com',
        'ns1.dan.com',
        'ns1.hugedomains.com',
        'ns1.afternic.com.'
    ]) {
        it(`reads ${host} as a parked domain`, () => {
            const outcome = classifyNameservers('example.com', [host]);
            assert.ok(outcome, `${host} should be recognised as parking`);
            assert.equal(outcome.status, 'clear');
            assert.match(outcome.detail ?? '', /parked/);
        });
    }

    /*
     * The dangerous half. These are registrar and CDN defaults that live
     * sites use every day — GoDaddy delegates every domain it registers to
     * domaincontrol.com, so treating it as parking would clear a large part
     * of the web. An inconclusive answer has to stay inconclusive.
     */
    for (const host of [
        'ns1.domaincontrol.com',
        'dns1.registrar-servers.com',
        'ada.ns.cloudflare.com',
        'ns-1234.awsdns-56.org',
        'ns1.vercel-dns.com',
        'ns1.googledomains.com'
    ]) {
        it(`says nothing about ${host}, which any live site might use`, () => {
            assert.equal(classifyNameservers('example.com', [host]), null);
        });
    }

    it('says nothing when the domain has no delegation to read', () => {
        assert.equal(classifyNameservers('example.com', []), null);
    });

    it('matches the service, not a lookalike hostname', () => {
        assert.equal(classifyNameservers('example.com', ['ns1.notbodis.com']), null);
        assert.equal(classifyNameservers('example.com', ['bodis.com.evil.test']), null);
    });

    it('finds the parking service wherever it sits in the list', () => {
        const hosts = ['ns1.example-registrar.com', 'ns2.sedoparking.com'];
        assert.equal(classifyNameservers('example.com', hosts)?.status, 'clear');
    });
});

/** Only the thin page is worth a DNS query; the other unknowns are not. */
describe('which unknowns a delegation could still settle', () => {
    it('flags a page too thin to judge', () => {
        const shell = '<body><div id="root"></div></body>';
        assert.equal(readPage(DOMAIN, served(shell)).unsettledThinPage, true);
    });

    it('does not flag a 5xx, which no nameserver explains', () => {
        const outcome = readPage(DOMAIN, served('', { status: 503, ok: false }));
        assert.equal(outcome.status, 'unknown');
        assert.ok(!outcome.unsettledThinPage);
    });

    it('does not flag a verdict that is already settled', () => {
        assert.ok(!readPage(DOMAIN, served(prose())).unsettledThinPage);
        assert.ok(!readPage(DOMAIN, served('<body><h1>Coming soon</h1></body>')).unsettledThinPage);
    });
});

describe('readFailure — a request that produced no response', () => {
    it('clears on ENOTFOUND, which is a real statement of absence', () => {
        const outcome = readFailure(DOMAIN, transportError('ENOTFOUND'));
        assert.equal(outcome.status, 'clear');
    });

    it('clears on ECONNREFUSED: registered, but nobody is trading behind it', () => {
        assert.equal(readFailure(DOMAIN, transportError('ECONNREFUSED')).status, 'clear');
    });

    /*
     * Every one of these arrives as the same 'TypeError: fetch failed'. A
     * certificate that expired and a reset connection are both evidence that a
     * server IS there, and EAI_AGAIN says the resolver failed rather than that
     * the name is unregistered. Matching on the message cleared all of them.
     */
    for (const code of [
        'EAI_AGAIN',
        'ECONNRESET',
        'ETIMEDOUT',
        'EHOSTUNREACH',
        'UND_ERR_CONNECT_TIMEOUT'
    ]) {
        it(`cannot judge ${code}, and says so in the detail`, () => {
            const outcome = readFailure(DOMAIN, transportError(code));
            assert.equal(outcome.status, 'unknown');
            assert.match(outcome.detail ?? '', new RegExp(code));
        });
    }

    /*
     * A certificate we would not accept is still a certificate. Getting far
     * enough to reject one means something is listening on 443 and presenting
     * itself as this name — a deployment nobody has renewed, not a free name.
     * The four spellings here are the ones this project has actually seen, and
     * they share no single prefix, which is why the test names them.
     */
    for (const code of [
        'CERT_HAS_EXPIRED',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
        'ERR_TLS_CERT_ALTNAME_INVALID'
    ]) {
        it(`reads ${code} as a server that is there`, () => {
            const outcome = readFailure(DOMAIN, transportError(code));
            assert.equal(outcome.status, 'taken');
            assert.match(outcome.detail ?? '', new RegExp(code));
        });
    }

    it('cannot judge a bare "fetch failed" that carries no cause at all', () => {
        assert.equal(readFailure(DOMAIN, transportError()).status, 'unknown');
    });

    it('finds a code nested further down the cause chain', () => {
        const outer = new TypeError('fetch failed');
        const middle = new Error('socket');
        middle.cause = Object.assign(new Error('dns'), { code: 'ENOTFOUND' });
        outer.cause = middle;
        assert.equal(readFailure(DOMAIN, outer).status, 'clear');
    });

    it('cannot judge a timeout, which reports no code', () => {
        const timeout = new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError'
        );
        assert.equal(readFailure(DOMAIN, timeout).status, 'unknown');
    });
});

/**
 * A domain that never answered, settled by DNS instead.
 *
 * A timeout is the only failure that carries no information whatever: nothing
 * refused us and nothing replied. 'clear' is therefore off the table without
 * corroboration, and DNS is asked to choose between the two readings left.
 */
describe('classifyDelegation', () => {
    const dns = (over: Partial<Parameters<typeof classifyDelegation>[1]> = {}) => ({
        ns: [],
        addresses: [],
        inconclusive: false,
        ...over
    });

    it('clears a parked delegation, which is inventory rather than a business', () => {
        const outcome = classifyDelegation('example.com', dns({ ns: ['ns1.sedoparking.com'] }));
        assert.equal(outcome?.status, 'clear');
    });

    /*
     * The conservative call, and the reason it differs from ECONNREFUSED next
     * door: a refused connection proves nothing is listening, while a timeout
     * proves nothing at all. A host that swallows the request is at least as
     * likely to be a live site behind something that dislikes us.
     */
    it('reads a registered, delegated domain as taken', () => {
        const outcome = classifyDelegation('example.com', dns({ ns: ['ns1.worldnic.com'] }));
        assert.ok(outcome, 'a delegated domain should be settled');
        assert.equal(outcome.status, 'taken');
        assert.match(outcome.detail ?? '', /did not answer/);
    });

    it('reads an address with no nameservers as taken too', () => {
        const outcome = classifyDelegation('example.com', dns({ addresses: ['203.0.113.9'] }));
        assert.equal(outcome?.status, 'taken');
    });

    it('clears a domain DNS says has neither nameservers nor an address', () => {
        const outcome = classifyDelegation('example.com', dns());
        assert.ok(outcome, 'a definite absence should be settled');
        assert.equal(outcome.status, 'clear');
    });

    /*
     * solenka.com. Its nameserver lookup came back empty while its A record
     * resolved perfectly — one query had simply fallen over. An empty answer
     * that DNS never actually gave must not be read as absence, or a live
     * domain gets called unregistered.
     */
    it('refuses to conclude anything when a lookup merely failed', () => {
        assert.equal(classifyDelegation('example.com', dns({ inconclusive: true })), null);
    });

    it('still trusts records it did receive alongside a failed lookup', () => {
        const outcome = classifyDelegation(
            'example.com',
            dns({ addresses: ['203.0.113.9'], inconclusive: true })
        );
        assert.equal(outcome?.status, 'taken');
    });
});

/** Which failures are worth a DNS query, and which explain themselves. */
describe('which failures a delegation could still settle', () => {
    for (const code of [
        'ETIMEDOUT',
        'ECONNRESET',
        'EHOSTUNREACH',
        'EAI_AGAIN',
        'UND_ERR_CONNECT_TIMEOUT'
    ]) {
        it(`flags ${code}, where nothing answered`, () => {
            assert.equal(readFailure(DOMAIN, transportError(code)).unsettledUnreachable, true);
        });
    }

    it('flags a bare timeout, which arrives with no code at all', () => {
        const timeout = new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError'
        );
        assert.equal(readFailure(DOMAIN, timeout).unsettledUnreachable, true);
    });

    /*
     * These already have their answer. A certificate or a refused connection
     * is a statement about the host, and no delegation is going to improve
     * on it — asking DNS would spend a query to learn nothing.
     */
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'CERT_HAS_EXPIRED']) {
        it(`does not flag ${code}, which is already settled`, () => {
            assert.ok(!readFailure(DOMAIN, transportError(code)).unsettledUnreachable);
        });
    }

    /*
     * And nor does an error that is neither settled nor a failure to reach
     * anything. These fall through to 'unverified' on their own account, and
     * sending them to DNS would let a delegation decide a question the error
     * was never about.
     */
    for (const code of ['EPROTO', 'ERR_INVALID_URL', 'ERR_UNESCAPED_CHARACTERS']) {
        it(`does not flag ${code}, which says nothing about reachability`, () => {
            const outcome = readFailure(DOMAIN, transportError(code));
            assert.equal(outcome.status, 'unknown');
            assert.ok(!outcome.unsettledUnreachable);
        });
    }
});

describe('the invariant', () => {
    it('never answers clear without positive evidence of absence', () => {
        const inconclusive: PageEvidence[] = [
            served('', { status: 403, ok: false }),
            served('', { status: 503, ok: false }),
            served('<body><div id="root"></div></body>'),
            served(prose('<span>Coming soon</span>'))
        ];
        for (const page of inconclusive) {
            assert.notEqual(readPage(DOMAIN, page).status, 'clear');
        }
        for (const code of ['EAI_AGAIN', 'CERT_HAS_EXPIRED', 'ECONNRESET']) {
            assert.notEqual(readFailure(DOMAIN, transportError(code)).status, 'clear');
        }
    });
});

describe('domains a broker is selling', () => {
    /*
     * branderist.com. Redirects to namevida.com, whose page reads
     * "Branderist.com is for sale!" — which matches none of PARKED_ALWAYS,
     * because a broker names the domain instead of using a registrar's stock
     * wording. The domain was reported as hosting a live business.
     */
    const BROKER =
        '<body>Namevida.com Home Names for sale Domains (847) 597-0044 Questions? ' +
        'Names for sale Branderist.com is for sale! 79 See it live Strong Buyer ' +
        'Interest Recently viewed or shortlisted by 3+ buyers. Secure Transactions ' +
        'Atom holds your payment until the domain is in your account.</body>';

    it('clears a domain a broker is advertising, however long the page', () => {
        const outcome = readPage('branderist.com', served(BROKER));
        assert.equal(outcome.status, 'clear');
        assert.match(outcome.detail ?? '', /broker/);
    });

    for (const phrasing of [
        'acme.com is for sale',
        'acme.com is available for purchase',
        'Buy acme.com today',
        'acquire acme.com'
    ]) {
        it(`recognises "${phrasing}"`, () => {
            assert.equal(offeredForSale('acme.com', phrasing.toLowerCase()), true);
        });
    }

    /*
     * The guard has to be anchored on the domain, or a shop selling anything
     * would clear itself. A business does not tell you its own name is for sale.
     */
    it('does not fire on a live site that merely sells things', () => {
        const shop = 'everything in our winter range is for sale until friday. buy now.';
        assert.equal(offeredForSale('acme.com', shop), false);
        assert.equal(readPage('acme.com', served(prose(`<p>${shop}</p>`))).status, 'taken');
    });

    it('does not fire on a different domain being advertised', () => {
        assert.equal(offeredForSale('acme.com', 'othername.com is for sale'), false);
    });

    /*
     * The same broker page, read for a different candidate. A list of domains
     * for sale is exactly where a name is likely to appear as somebody else's
     * suffix, so an unbounded match cleared vida.com off a page selling
     * namevida.com — a false 'free', which is the one answer that must never
     * be guessed.
     */
    for (const [domain, text] of [
        ['vida.com', 'namevida.com is for sale! see it live'],
        ['acme.com', 'buy myacme.com today'],
        ['acme.com', 'acme.com.au is for sale'],
        ['acme.com', 'buy acme.community']
    ] as const) {
        it(`does not read "${text}" as an offer of ${domain}`, () => {
            assert.equal(offeredForSale(domain, text), false);
        });
    }

    /** A host in front of the same domain is still the same domain. */
    it('still fires when the domain is written with a host in front of it', () => {
        assert.equal(offeredForSale('acme.com', 'www.acme.com is for sale'), true);
    });
});
