/**
 * The .com — but only a LIVE BUSINESS counts as taken.
 *
 * Registered is not the same as unavailable. Parked pages, for-sale listings,
 * registrar placeholders, squatted names and dormant registrations are all
 * acquirable, and treating them as collisions throws away most of the good
 * names. What actually blocks you is somebody trading under the name.
 *
 * Cheapest check by a wide margin — DNS and one HTTP request, no third-party
 * quota — which is why it runs first and thins the field before the
 * rate-limited store checks see anything.
 */

import { squash, type CheckOutcome } from './shared.ts';

/** Phrases that mean a page exists but no business is behind it. */
const PARKED = [
    'domain is for sale',
    'buy this domain',
    'domain for sale',
    'this domain is parked',
    'parked free',
    'courtesy of godaddy',
    'domain name is available',
    'checkout the full domain details',
    'this webpage is parked',
    'under construction',
    'coming soon',
    'default web site page',
    'apache2 ubuntu default',
    'welcome to nginx',
    'future home of something'
];

export async function checkCom(name: string): Promise<CheckOutcome> {
    const domain = `${squash(name)}.com`;
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

        // 4xx/5xx means nothing is being served, which is as good as free.
        if (!response.ok) {
            return { status: 'clear', detail: `${domain} serves ${response.status}` };
        }

        const html = (await response.text()).toLowerCase();
        if (PARKED.some((phrase) => html.includes(phrase))) {
            return { status: 'clear', detail: `${domain} is parked or for sale` };
        }
        // A real site has content. A holding page usually does not.
        if (html.replace(/<[^>]*>/g, '').trim().length < 400) {
            return { status: 'clear', detail: `${domain} has no real content` };
        }
        return { status: 'taken', detail: `${domain} hosts a live site` };
    } catch (error) {
        const message = (error as Error).message;
        // DNS failure or refused connection means nothing is there — free.
        if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo|fetch failed/i.test(message)) {
            return { status: 'clear', detail: `${domain} does not resolve` };
        }
        return { status: 'unknown', detail: message };
    }
}
