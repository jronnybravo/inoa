/**
 * A domain — but only a LIVE BUSINESS counts as taken.
 *
 * Registered is not the same as unavailable. Parked pages, for-sale listings,
 * registrar placeholders, squatted names and dormant registrations are all
 * acquirable, and treating them as collisions throws away most of the good
 * names. What actually blocks you is somebody trading under the name.
 *
 * Cheapest check by a wide margin — DNS and one HTTP request, no third-party
 * quota — which is why it runs first and thins the field before the
 * rate-limited store checks see anything.
 *
 * THREE STATES, NOT TWO
 *
 * This check used to have two exits, and every path that was not obviously a
 * live site fell out as 'clear'. That turns an absence of evidence into a
 * positive claim of absence, which is the failure this project exists to
 * prevent — and worse than the case the README warns about, because it renders
 * a known collision as a clean cell rather than a blank one. Measured against
 * ten unambiguously-live brands, two came back free:
 *
 *   - linear.com answers 403 to this user agent, as ordinary bot protection
 *     does. A server declining to answer is not a server that isn't there.
 *   - asana.com carries a "Coming soon" badge on a product in its navigation
 *     flyout, and the parked-page phrases were matched against the whole raw
 *     document — script bodies and all.
 *
 * So 'clear' now requires positive evidence: the name does not resolve, nothing
 * accepts a connection, the server says 404, or the page says in its own words
 * that it is for sale. Everything else that cannot be established is 'unknown',
 * which never drops a name and never counts as a pass.
 */

import { Resolver } from 'node:dns/promises';
import { squash, type CheckOutcome } from './shared.ts';

/**
 * Phrases that only ever appear on a registrar placeholder or a stock server
 * page. None of these is something a business writes about itself, so finding
 * one is enough on its own.
 */
const PARKED_ALWAYS = [
    'domain is for sale',
    'buy this domain',
    'domain for sale',
    'this domain is parked',
    'this webpage is parked',
    'parked free',
    'courtesy of godaddy',
    'domain name is available',
    'checkout the full domain details',
    'default web site page',
    'apache2 ubuntu default',
    'welcome to nginx',
    'future home of something'
];

/**
 * The page is offering this very domain for sale rather than trading under it.
 *
 * PARKED_ALWAYS catches a registrar's stock wording. A broker writes something
 * different: it names the domain. branderist.com redirects to a broker whose
 * page reads "Branderist.com is for sale!", which matches none of the fixed
 * phrases — so a domain explicitly listed for sale was reported as a live
 * business.
 *
 * Anchoring on the domain itself is what makes this safe to trust: a company
 * actually trading under a name does not tell you the name is purchasable.
 */
export function offeredForSale(domain: string, text: string): boolean {
    /*
     * Bounded on both sides, because a broker page is a LIST of domains.
     *
     * Unanchored, 'vida.com' matched inside "Namevida.com is for sale!" — a
     * page selling somebody else's name cleared ours. The left edge stops at a
     * letter, digit or hyphen but allows a dot, so "www.vida.com is for sale"
     * still counts: that is the same domain with a host in front of it. The
     * right edge also refuses a dot, so "vida.com.au is for sale" does not.
     */
    const named = domain.replace(/\./g, '\\.');
    const token = `(?<![a-z0-9-])${named}(?![a-z0-9.-])`;
    return new RegExp(
        `${token}\\s*(?:is\\s+)?(?:for sale|available for purchase|available now)` +
            `|(?:buy|purchase|acquire|own)\\s+${token}`,
        'i'
    ).test(text);
}

/**
 * Ordinary English that a live site also uses.
 *
 * 'Coming soon' is a product badge on half the marketing sites on the web —
 * it is what cleared asana.com — and 'under construction' shows up in blog
 * copy and changelogs. They only mean a holding page when they are
 * substantially the entire page, so they are only trusted on a thin one.
 */
const PARKED_IF_ALONE = ['under construction', 'coming soon'];

/**
 * Above this much visible prose, a page is making a claim of its own.
 *
 * The number is small because the gap it sits in is enormous. Measured across
 * live sites and holding pages, visible text is bimodal: lumora.com renders
 * zero characters, airbnb.com renders 375 — all of it navigation naming the
 * brand — and every ordinary business site in the sample ran 3,600 to 13,000.
 * Nothing landed in between. Anything with navigation in it was built by
 * somebody; a holding page's whole message fits in a sentence.
 *
 * It used to be 400, against a very different quantity: the old text extraction
 * stripped tags but left every inline <script> behind, so a page with a
 * JavaScript bundle measured in the hundreds of thousands and the threshold
 * almost never fired. Now that scripts are excluded the same constant would
 * catch real companies — it read airbnb.com as an empty lot.
 *
 * Below the line we genuinely cannot tell a stub from an app that renders
 * everything client-side, so that stays 'unknown' rather than 'clear'.
 */
const HOLDING_PAGE_MAX = 120;

/** Statuses that are a positive statement that nothing is published there. */
const ABSENT_STATUS = new Set([404, 410]);

/**
 * Statuses that prove a deployment rather than describe one.
 *
 * These are all refusals from something that understood the request and
 * decided not to serve it: a WAF, an auth wall, a rate limiter, a suspended
 * account, a legal block. We learn nothing about the business behind them and
 * we do not need to — nobody puts a WAF in front of a name they are not using,
 * so the domain is not available, which is the only question this check asks.
 *
 * 5xx is deliberately not here. A 502 from a CDN with a dead origin and a 503
 * from a lapsed host look identical from outside, and the second is a domain
 * somebody stopped paying for.
 */
const REFUSED_STATUS = new Set([401, 402, 403, 405, 406, 429, 451]);

/**
 * Error codes that mean nothing is being served, as opposed to nothing could
 * be reached, mapped to how the row should read. Both leave the name
 * acquirable: a domain that does not resolve is unregistered, and one that
 * refuses connections is registered but has nobody trading behind it, which
 * this check has always counted as free.
 */
const ABSENT_CODES: Record<string, string> = {
    ENOTFOUND: 'does not resolve',
    ECONNREFUSED: 'refuses connections'
};

/**
 * A TLS failure, which is a server saying hello badly rather than no server.
 *
 * Reaching a certificate at all means something is listening on 443 and
 * presenting itself as this name. An expired one, a self-signed one and one
 * from an unknown CA are all somebody's deployment that nobody has renewed —
 * the domain is in use, whatever state the site is in.
 *
 * Matched by shape rather than enumerated: Node surfaces these from OpenSSL
 * under names that change with the library, and the ones seen here alone were
 * CERT_HAS_EXPIRED, DEPTH_ZERO_SELF_SIGNED_CERT, UNABLE_TO_VERIFY_LEAF_
 * SIGNATURE and ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR — no single prefix covers
 * that set.
 */
function isTlsRefusal(code: string): boolean {
    return (
        code.startsWith('ERR_TLS_') ||
        code.startsWith('ERR_SSL_') ||
        code.includes('CERT') ||
        code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    );
}

/**
 * Nameservers that only ever serve a parked domain.
 *
 * This is the one thing DNS settles that an HTTP request cannot. A holding
 * page and an app that renders itself in the browser are the same handful of
 * bytes over HTTP, and no amount of reading the body separates them — but a
 * domain delegated to Sedo or Bodis is not running an app, it is inventory.
 *
 * Every entry has to be a service that does nothing else, which is a stricter
 * bar than it looks. GoDaddy's domaincontrol.com is deliberately absent: it is
 * the default delegation for every domain registered there, live sites
 * included, so matching it would clear half the web. Cloudflare, Namecheap's
 * registrar-servers.com and the other registrar defaults are out for the same
 * reason.
 */
const PARKING_NS = [
    'sedoparking.com',
    'parkingcrew.net',
    'bodis.com',
    'above.com',
    'dan.com',
    'undeveloped.com',
    'afternic.com',
    'hugedomains.com',
    'cashparking.com',
    'fabulous.com',
    'parklogic.com',
    'domainparkingserver.net',
    'voodoo.com',
    'sav.com',
    'namefind.com'
];

/**
 * What a domain's delegation says, when it says anything.
 *
 * Returns null for the ordinary case — a nameserver that could belong to
 * anyone tells us nothing, and this check does not guess.
 */
export function classifyNameservers(domain: string, hosts: string[]): CheckOutcome | null {
    for (const host of hosts) {
        const lower = host.toLowerCase().replace(/\.$/, '');
        const service = PARKING_NS.find((ns) => lower === ns || lower.endsWith(`.${ns}`));
        if (service) {
            return {
                status: 'clear',
                detail: `${domain} is parked — delegated to ${service}`
            };
        }
    }
    return null;
}

/** What DNS says about a domain, and whether it managed to say it. */
export interface Delegation {
    ns: string[];
    addresses: string[];
    /**
     * A lookup that failed to answer, as against one that answered 'nothing'.
     *
     * The distinction is the whole safety of the rule below. solenka.com
     * returned no nameservers here while its A record resolved perfectly —
     * one query had simply fallen over. Treating that silence as 'no
     * delegation exists' would have called a live domain unregistered, so an
     * empty answer only counts when DNS actually said the record is absent.
     */
    inconclusive: boolean;
}

/** Resolver codes that mean the record genuinely is not there. */
const ABSENT_DNS = new Set(['ENOTFOUND', 'NXDOMAIN', 'ENODATA']);

/**
 * Ask DNS what it knows, on its own short clock.
 *
 * This runs only for the handful of names nothing else could settle, and a
 * stalled query must not cost more than the HTTP request that got us here.
 */
async function lookupDelegation(domain: string): Promise<Delegation> {
    const resolver = new Resolver({ timeout: 4000, tries: 2 });
    let inconclusive = false;
    const ask = async (query: () => Promise<string[]>): Promise<string[]> => {
        try {
            return await query();
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            if (typeof code !== 'string' || !ABSENT_DNS.has(code)) {
                inconclusive = true;
            }
            return [];
        }
    };
    return {
        ns: await ask(() => resolver.resolveNs(domain)),
        addresses: await ask(() => resolver.resolve4(domain)),
        inconclusive
    };
}

/**
 * What a delegation settles for a domain that never answered HTTP.
 *
 * A timeout is the one failure that carries no information at all: nothing
 * refused us and nothing replied, so 'clear' is off the table — this check
 * does not call a name free without positive evidence. That leaves DNS to
 * decide between the two remaining readings.
 *
 * Registered and pointed at a host is treated as taken. It is not proof that
 * anybody is trading there, and it is deliberately the conservative call: a
 * host that swallows our request is at least as likely to be a live site
 * behind something that dislikes us as it is to be a dormant name.
 *
 * This is why ECONNREFUSED next door stays 'clear' and a timeout does not.
 * A refused connection is a positive statement that nothing is listening; a
 * timeout is the absence of any statement.
 */
export function classifyDelegation(domain: string, dns: Delegation): CheckOutcome | null {
    const parked = classifyNameservers(domain, dns.ns);
    if (parked) {
        return parked;
    }
    if (dns.ns.length > 0 || dns.addresses.length > 0) {
        return {
            status: 'taken',
            detail: `${domain} is registered and points at a host that did not answer`
        };
    }
    if (dns.inconclusive) {
        return null;
    }
    return { status: 'clear', detail: `${domain} has no nameservers and no address` };
}

/**
 * The text a reader would actually see.
 *
 * Stripping tags alone is not enough: it leaves the contents of every <script>
 * behind as prose, so a minified bundle counted towards the content threshold
 * and any phrase appearing in a JavaScript string counted as a parked-page
 * marker. Whole elements go first, then the tags around what is left.
 */
export function visibleText(html: string): string {
    return html
        .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** What one response actually established, separated from how it was fetched. */
export interface PageEvidence {
    status: number;
    ok: boolean;
    html: string;
    /** Where we ended up, which is not where we asked when a domain redirects. */
    finalUrl?: string;
}

/** Follow the cause chain undici wraps a transport error in. */
function causeCode(error: unknown): string | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
        const code = (current as Error & { code?: unknown }).code;
        if (typeof code === 'string') {
            return code;
        }
        current = current.cause;
    }
    return undefined;
}

/**
 * A page verdict, plus whether anything else could still settle it.
 *
 * The flag exists so checkDomain can tell one 'unknown' from another without
 * reading the detail string back. Only the thin-page case is worth a DNS
 * query; a 5xx or a timeout is not going to be explained by a delegation.
 */
export interface PageVerdict extends CheckOutcome {
    unsettledThinPage?: boolean;
}

/** The verdict for a response we did get back. */
export function readPage(domain: string, page: PageEvidence): PageVerdict {
    if (!page.ok) {
        if (ABSENT_STATUS.has(page.status)) {
            return {
                status: 'clear',
                detail: `${domain} serves ${page.status} — nothing published`
            };
        }
        if (REFUSED_STATUS.has(page.status)) {
            return {
                status: 'taken',
                detail: `${domain} answered ${page.status} — a server is deployed there`
            };
        }
        /*
         * What is left is mostly 5xx: an origin that is down, or a host that
         * has been switched off. Neither says whether the name is in use.
         */
        return { status: 'unknown', detail: `${domain} answered ${page.status}; not verified` };
    }

    const text = visibleText(page.html);
    const lower = text.toLowerCase();
    const thin = text.length < HOLDING_PAGE_MAX;

    const stated = PARKED_ALWAYS.find((phrase) => lower.includes(phrase));
    if (stated) {
        return { status: 'clear', detail: `${domain} is parked or for sale — "${stated}"` };
    }

    if (offeredForSale(domain, lower)) {
        return { status: 'clear', detail: `${domain} is listed for sale by a broker` };
    }

    const alone = thin ? PARKED_IF_ALONE.find((phrase) => lower.includes(phrase)) : undefined;
    if (alone) {
        return { status: 'clear', detail: `${domain} is a holding page — "${alone}"` };
    }

    if (thin) {
        return {
            status: 'unknown',
            detail: `${domain} serves ${text.length} characters of text; too little to judge`,
            unsettledThinPage: true
        };
    }

    // A redirect target is worth naming: it is who the domain actually belongs to.
    const landed = page.finalUrl ? ` (redirects to ${page.finalUrl})` : '';
    return { status: 'taken', detail: `${domain} hosts a live site${landed}` };
}

/**
 * Transport codes that mean nothing answered, which is not the same as
 * nothing being there. Each of these leaves the question open, so each is
 * worth one DNS query before it is written off as unverified.
 */
const UNREACHABLE_CODES = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET'
]);

/**
 * A failure verdict, plus whether DNS could still settle it.
 *
 * The flag keeps readFailure pure and synchronous: it says what the error
 * establishes on its own, and checkDomain decides whether that is worth a
 * second question.
 */
export interface FailureVerdict extends CheckOutcome {
    unsettledUnreachable?: boolean;
}

/**
 * Did nothing answer, as opposed to something answering badly?
 *
 * A bare timeout arrives as a DOMException carrying no code at all — only the
 * name and message distinguish it — so the message is the fallback.
 */
function isUnreachable(error: unknown, code: string | undefined): boolean {
    if (code !== undefined) {
        return UNREACHABLE_CODES.has(code);
    }
    const described = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    return /timeout|timed out|aborted/i.test(described);
}

/** The verdict for a request that never produced a response. */
export function readFailure(domain: string, error: unknown): FailureVerdict {
    const code = causeCode(error);
    const absent = code === undefined ? undefined : ABSENT_CODES[code];
    if (absent) {
        return { status: 'clear', detail: `${domain} ${absent}` };
    }

    if (code !== undefined && isTlsRefusal(code)) {
        return {
            status: 'taken',
            detail: `${domain} serves TLS with a certificate we would not accept (${code})`
        };
    }

    /*
     * Everything else is a failure to find out, not a finding.
     *
     * undici reports every transport-layer problem as the same
     * 'TypeError: fetch failed' — an expired certificate, a reset connection
     * and a real NXDOMAIN are indistinguishable by message, and only
     * error.cause carries the code that tells them apart. Matching on the
     * message is what filed a live site behind a broken certificate as free.
     */
    const reason = code ?? (error instanceof Error ? error.message : String(error));
    return {
        status: 'unknown',
        detail: `${domain}: ${reason}`,
        unsettledUnreachable: isUnreachable(error, code) || undefined
    };
}

export async function checkDomain(name: string, tld: string): Promise<CheckOutcome> {
    const domain = `${squash(name)}.${tld}`;
    try {
        const response = await fetch(`https://${domain}`, {
            redirect: 'follow',
            headers: {
                'user-agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(12000)
        });

        // The body is only read when it can change the answer, so a status that
        // settles it on its own does not also pay for a download.
        const html = response.ok ? await response.text() : '';
        const landed = new URL(response.url);
        const verdict = readPage(domain, {
            status: response.status,
            ok: response.ok,
            html,
            finalUrl: landed.hostname === domain ? undefined : landed.origin
        });

        /*
         * A page too thin to read is the one verdict DNS can improve on, and
         * only in one direction: a domain delegated to a parking service is
         * inventory rather than a business, which is the distinction the body
         * could not make. Anything else keeps the page's own answer, so this
         * costs one DNS query on the handful of names that reach it.
         */
        if (verdict.unsettledThinPage) {
            const dns = await lookupDelegation(domain);
            return classifyNameservers(domain, dns.ns) ?? verdict;
        }
        return verdict;
    } catch (error) {
        const verdict = readFailure(domain, error);
        /*
         * Nothing answered, so the page tells us nothing — but DNS still
         * might. A parked delegation makes the name acquirable, a missing one
         * makes it unregistered, and anything in between is a registered
         * domain we cannot see behind.
         */
        if (verdict.unsettledUnreachable) {
            return classifyDelegation(domain, await lookupDelegation(domain)) ?? verdict;
        }
        return verdict;
    }
}
