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

import { randomBytes } from 'node:crypto';
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
 * A connection refused by something that is listening at the address.
 *
 * The name resolved and a host answered the packet with 'no'. That is a
 * positive statement that nothing is served there, and it leaves the name
 * acquirable, which this check has always counted as free.
 *
 * ENOTFOUND used to sit beside it and does not any more. getaddrinfo reports
 * one code for two different answers — the name genuinely does not exist, and
 * the resolver could not find out — so 'does not resolve' was being read as
 * 'unregistered' for domains that are registered and working. pldt.ph and
 * jollibee.ph are both live registrations delegated to Cloudflare with no A
 * record on the bare name, and both came back free; grab.ph and lazada.ph
 * answer SERVFAIL, which reached us as the same code. It is settled against
 * DNS in checkDomain now rather than taken at face value here.
 */
const REFUSED_CODE = 'ECONNREFUSED';

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
    /*
     * Both at once. They ask different questions of the same servers and
     * neither needs the other's answer, but they used to run in sequence — so a
     * domain whose nameservers answer SERVFAIL paid the full timeout twice over
     * before saying 'we could not tell'. grab.ph is one.
     */
    const [ns, addresses] = await Promise.all([
        ask(() => resolver.resolveNs(domain)),
        ask(() => resolver.resolve4(domain))
    ]);
    return { ns, addresses, inconclusive };
}

/**
 * Does this registry answer for names nobody has registered?
 *
 * Most do not: ask .com for a name that does not exist and you get NXDOMAIN,
 * which is how this check knows a name is free. A handful of ccTLDs answer
 * anyway, pointing every unregistered name at one of their own hosts —
 * Verisign did it to .com for a fortnight in 2003 and had to stop; .ph still
 * does it today.
 *
 * It breaks this check in the worst possible direction. Every free .ph name
 * resolved to 45.79.222.138, which speaks TLS badly, so isTlsRefusal above read
 * a certificate error as 'a server is deployed there' and reported the name
 * TAKEN. Measured: zzqwkrblxmvn.ph and qpwoeirutyalsk.ph — gibberish nobody has
 * ever registered — both came back taken, which makes the whole TLD useless
 * rather than merely wrong about one name.
 *
 * Probed rather than listed. Which registries do this changes on their own
 * schedule and a hardcoded list would be wrong the week after it was written,
 * so a random label is asked for once per TLD and whatever it answers becomes
 * the signature. A registry that answers nothing — nearly all of them — costs
 * one query per process and nothing else ever again.
 */
const probes = new Map<string, Promise<Set<string>>>();

/** Exported for the tests: the cache is per process and outlives a case. */
export function resetWildcardProbes(): void {
    probes.clear();
}

export function wildcardAddresses(tld: string): Promise<Set<string>> {
    const known = probes.get(tld);
    if (known) {
        return known;
    }
    const asking = (async () => {
        /*
         * Random, and long enough that nobody has it. A fixed label would be
         * registrable — and somebody registering it would switch this off for
         * the whole TLD, which is a failure nothing would ever notice.
         */
        const label = `inoa-probe-${randomBytes(8).toString('hex')}`;
        const dns = await lookupDelegation(`${label}.${tld}`);
        /*
         * Addresses alone. A registry that delegates a nonexistent name to its
         * own nameservers is describing its zone, not answering for the name,
         * and treating that as a signature would clear every domain in the TLD.
         */
        return dns.ns.length === 0 ? new Set(dns.addresses) : new Set<string>();
    })();
    probes.set(tld, asking);
    return asking;
}

/**
 * Is this name only the registry's own answer for 'no such domain'?
 *
 * Both halves are required. The addresses have to be the wildcard's and
 * nothing else, and the name must have no delegation of its own — a registered
 * domain has nameservers, and an unregistered one under a wildcard has none.
 * Either alone would be guesswork; together they are what the zone actually
 * says.
 */
export function isWildcardOnly(dns: Delegation, wildcard: ReadonlySet<string>): boolean {
    if (wildcard.size === 0 || dns.inconclusive || dns.ns.length > 0) {
        return false;
    }
    return dns.addresses.length > 0 && dns.addresses.every((address) => wildcard.has(address));
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
    if (code === REFUSED_CODE) {
        return { status: 'clear', detail: `${domain} refuses connections` };
    }

    /*
     * The name did not resolve — which is either the answer or the absence of
     * one, and this cannot tell which. checkDomain asks DNS directly.
     */
    if (code === 'ENOTFOUND') {
        return {
            status: 'unknown',
            detail: `${domain} did not resolve`,
            unsettledUnreachable: true
        };
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

    /*
     * One delegation lookup per call, however many paths below want it.
     *
     * Three of them can, and a name that reaches two used to pay twice: a
     * .ph domain whose nameservers answer SERVFAIL was queried once for the
     * wildcard test and again after the request failed, and since SERVFAIL is
     * the slowest possible answer — every try, every retry, to the full
     * timeout — grab.ph took forty seconds to reach 'we could not tell'.
     */
    let asked: Promise<Delegation> | undefined;
    const delegation = () => (asked ??= lookupDelegation(domain));

    /*
     * Under a wildcarding registry, ask DNS before anything else.
     *
     * The HTTP request cannot settle this and actively misleads: the registry's
     * catch-all host answers, so a free name looks like a deployment. Asking
     * the zone first is both correct and cheaper — a free name never reaches
     * the network at all. The probe is memoised per TLD and empty for almost
     * every registry, so this costs one query per process and then nothing.
     */
    const wildcard = await wildcardAddresses(tld);
    if (wildcard.size > 0) {
        const dns = await delegation();
        if (isWildcardOnly(dns, wildcard)) {
            return {
                status: 'clear',
                detail: `${domain} is unregistered — .${tld} answers every name it does not have`
            };
        }
        const parked = classifyNameservers(domain, dns.ns);
        if (parked) {
            return parked;
        }
    }

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
            const dns = await delegation();
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
            return classifyDelegation(domain, await delegation()) ?? verdict;
        }
        return verdict;
    }
}
