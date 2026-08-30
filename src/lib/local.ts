/**
 * Is the caller on this machine or this network?
 *
 * Two things key off this: rate limiting, and how much work a single run is
 * allowed to ask for. Both exist to protect a public deployment's CPU and its
 * standing with the public APIs it calls — neither concern applies when you are
 * running the app on your own laptop.
 *
 * Set BRANDY_RATE_LIMIT_ALL=1 to be treated as remote everywhere, for testing
 * the public path.
 */
export function isLocalAddress(address: string | undefined): boolean {
  if (process.env.BRANDY_RATE_LIMIT_ALL === '1') return false;
  if (!address) return false;
  const host = address.replace(/^::ffff:/, '');
  return (
    host === '127.0.0.1' ||
    host === '::1' ||
    host === 'localhost' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}
