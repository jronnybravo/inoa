/**
 * Domain availability.
 *
 * RDAP is the authoritative source (it is the registry's own protocol, and it
 * is free and unauthenticated), so it is tried first. DNS is the fallback: a
 * domain with nameservers is definitely registered, though the absence of
 * nameservers does not prove the reverse — plenty of registered domains are
 * parked without DNS, which is why that case is reported as 'unknown' rather
 * than guessed.
 */

import { Resolver } from 'node:dns/promises';
import { isOffline, mapLimit, probe } from '../core/net.ts';
import { normalize } from '../core/text.ts';
import type { Availability, DomainCheck } from '../core/types.ts';

export const DEFAULT_TLDS = ['com', 'io', 'ai', 'co'];

const resolver = new Resolver({ timeout: 3000, tries: 1 });
resolver.setServers(['1.1.1.1', '8.8.8.8']);

async function rdapStatus(domain: string): Promise<Availability | undefined> {
  // rdap.org is a bootstrap service: it 302s to whichever registry is
  // authoritative for the TLD, so the redirect has to be followed.
  const status = await probe(`https://rdap.org/domain/${domain}`, {
    method: 'GET',
    timeoutMs: 8000,
    ttlMs: 3 * 24 * 60 * 60 * 1000,
    followRedirects: true,
  });
  if (status === undefined) return undefined;
  if (status === 404) return 'available';
  if (status === 200) return 'taken';
  // 429 rate limit, 5xx outage, or a registry with no RDAP service.
  return undefined;
}

async function dnsStatus(domain: string): Promise<Availability | undefined> {
  try {
    const ns = await resolver.resolveNs(domain);
    return ns.length > 0 ? 'taken' : undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // NXDOMAIN is strong evidence, but parked-without-DNS is common enough
    // that we report it as unresolved rather than available.
    if (code === 'ENOTFOUND' || code === 'ENODATA') return undefined;
    return undefined;
  }
}

/**
 * Is a real site running here?
 *
 * Registration alone says nothing about whether a name is usable. What matters
 * is whether a business already operates on it: a squatted, parked, for-sale or
 * dormant domain can be bought or waited out, while an active product cannot.
 *
 * The signals are structural rather than textual, so this does not depend on
 * recognizing any particular parking provider or sales page: nothing served,
 * an error, a redirect away to another host, or a page too thin to be a real
 * site all mean no one is operating here.
 */
async function classifyUse(domain: string): Promise<{ status: Availability; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://${domain}/`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
    });

    if (!response.ok) {
      return { status: 'no-active-site', detail: `registered, serves HTTP ${response.status}` };
    }
    const finalHost = new URL(response.url).hostname.replace(/^www\./, '');
    if (finalHost !== domain) {
      return { status: 'no-active-site', detail: `registered, redirects to ${finalHost}` };
    }
    const body = await response.text();
    const title = /<title[^>]*>(.*?)<\/title>/is.exec(body)?.[1]?.trim() ?? '';
    if (body.length < 20000 || !title) {
      return { status: 'no-active-site', detail: 'registered, but the page is a placeholder' };
    }
    return { status: 'taken', detail: `live site: ${title.slice(0, 60)}` };
  } catch {
    return { status: 'no-active-site', detail: 'registered, but nothing responds' };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkDomain(name: string, tld: string): Promise<DomainCheck> {
  const domain = `${normalize(name)}.${tld}`;
  if (isOffline()) {
    return { domain, status: 'unknown', method: 'offline', detail: 'network checks disabled' };
  }

  const rdap = await rdapStatus(domain);
  if (rdap === 'available') return { domain, status: 'available', method: 'rdap' };
  if (rdap === 'taken') {
    // Registered is only half the answer. Whether anyone is operating on it is
    // the half that decides if the name is usable.
    const use = await classifyUse(domain);
    return {
      domain,
      status: use.status,
      method: 'rdap + site check',
      detail: use.detail,
      url: `https://${domain}/`,
    };
  }

  const dns = await dnsStatus(domain);
  if (dns) return { domain, status: dns, method: 'dns' };

  return {
    domain,
    status: 'unknown',
    method: 'rdap+dns',
    detail: 'no authoritative answer — verify at a registrar before deciding',
  };
}

export async function checkDomains(
  name: string,
  tlds: string[] = DEFAULT_TLDS,
): Promise<DomainCheck[]> {
  return mapLimit(tlds, 3, (tld) => checkDomain(name, tld));
}

/**
 * A 0..100 estimate of how ownable the name is at the DNS level.
 * The exact-match .com still dominates the calculation, because it still
 * dominates how people type.
 */
export function domainScore(checks: DomainCheck[]): number {
  if (checks.length === 0) return 50;
  const weights: Record<string, number> = { com: 3, ai: 1.6, io: 1.3, co: 1 };
  let earned = 0;
  let possible = 0;
  for (const check of checks) {
    const tld = check.domain.split('.').at(-1) as string;
    const weight = weights[tld] ?? 1;
    possible += weight;
    if (check.status === 'available') earned += weight;
    // A registered domain with no business on it is obtainable — worth much
    // more than one with a live product behind it.
    else if (check.status === 'no-active-site') earned += weight * 0.6;
    else if (check.status === 'unknown') earned += weight * 0.45;
    else if (check.status === 'premium-or-parked') earned += weight * 0.25;
  }
  return possible === 0 ? 50 : Math.round((earned / possible) * 100);
}
