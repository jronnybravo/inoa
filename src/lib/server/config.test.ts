/**
 * Where we connect, and whether we encrypt getting there.
 *
 * Both decisions used to be made twice from different inputs, and could
 * disagree: with DB_HOST unset, the TLS check tested '' (not loopback, so TLS
 * on) while the connection fell back to 'localhost' (which does not speak TLS).
 * The driver then reported "the server does not support SSL connections",
 * which names neither cause.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hostFromUrl, isLoopbackHost } from './config.ts';

describe('isLoopbackHost', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
        it(`treats ${host} as this machine`, () => {
            assert.equal(isLoopbackHost(host), true);
        });
    }

    /*
     * The old test was a substring match over the whole connection string, so
     * any of these disabled TLS against a remote server — a check that fails
     * open, which is the wrong direction for one guarding transport security.
     */
    for (const host of [
        'db.example.com',
        'localhost.attacker.example',
        'my-localhost-db.neon.tech',
        '10.0.0.5',
        ''
    ]) {
        it(`does not treat ${JSON.stringify(host)} as this machine`, () => {
            assert.equal(isLoopbackHost(host), false);
        });
    }
});

describe('hostFromUrl', () => {
    it('reads the hostname, not the rest of the string', () => {
        assert.equal(
            hostFromUrl('postgresql://user:pass@db.example.com:5432/app'),
            'db.example.com'
        );
    });

    /*
     * The credential and database name are attacker- or accident-controlled
     * text that used to be searched for 'localhost'.
     */
    it('ignores localhost appearing in the password or database name', () => {
        const url = 'postgresql://user:localhost@db.example.com/localhost';
        assert.equal(hostFromUrl(url), 'db.example.com');
        assert.equal(isLoopbackHost(hostFromUrl(url)), false);
    });

    it('recognises a genuinely local URL', () => {
        assert.equal(isLoopbackHost(hostFromUrl('postgresql://u:p@localhost:55432/app')), true);
    });

    it('returns empty for a string that will not parse, which reads as remote', () => {
        assert.equal(hostFromUrl('not a url'), '');
        assert.equal(isLoopbackHost(hostFromUrl('not a url')), false);
    });
});
