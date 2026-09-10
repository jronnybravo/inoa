/**
 * The app under the environments it actually ships into.
 *
 * Nearly every behaviour that has broken here was a behaviour that only exists
 * under one configuration: the form asked for an address on a deployment with
 * no way to send one, and the web check queued a browser for a run that had
 * declined it. The unit tests cannot see any of that, because the thing that
 * varies is the environment rather than the input.
 *
 * So this boots a real server per configuration and asks it real questions.
 * Each case starts vite with a named env, waits for it to answer, checks the
 * served HTML and the API, and cleans up whatever it created.
 *
 *   node --experimental-strip-types scripts/env-matrix.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import 'dotenv/config';
import { Like } from 'typeorm';
import { db } from '../src/lib/server/db.ts';
import { Candidate } from '../src/lib/server/entities/candidate.ts';
import { Run } from '../src/lib/server/entities/run.ts';
import { Verification } from '../src/lib/server/entities/verification.ts';

const PORT_BASE = 5310;

/** A run this script would accept: the shape the form posts, minus the address. */
const RUN = {
    brief: 'A marketplace connecting local farms to restaurant kitchens in coastal towns.',
    strategies: ['compound'],
    languages: [],
    tlds: ['com'],
    requiredTlds: ['com'],
    handles: [],
    requiredHandles: [],
    stores: ['appStore'],
    requiredStores: ['appStore'],
    webLinks: false,
    requireAppStore: true,
    requirePlayStore: false,
    requireGoogle: false,
    targetCount: 50
};

/** What /api/runs answers with, for the two outcomes this asks about. */
interface RunReply {
    id?: string;
    verified?: boolean;
    message?: string;
}

/** JSON or nothing — a 500 with an HTML body should read as a failed check. */
const reply = async (response: Response): Promise<RunReply> =>
    (await response.json().catch(() => ({}))) as RunReply;

/** Marks the runs this script makes, so cleanup never has to guess. */
const MARK = 'env-matrix probe —';

/** One configuration to boot under, and what makes it different. */
interface Case {
    name: string;
    env: Record<string, string>;
    /** The database is pointed somewhere dead, so the API cases are skipped. */
    dbDown?: boolean;
}

const CASES: Case[] = [
    { name: 'no mail, no search', env: {} },
    { name: 'mail, no search', env: { RESEND_API_KEY: 're_probe_invalid' } },
    { name: 'no mail, search', env: { TAVILY_API_KEY: 'tvly-probe' } },
    {
        name: 'mail and search',
        env: { RESEND_API_KEY: 're_probe_invalid', TAVILY_API_KEY: 'tvly-probe' }
    },
    { name: 'no database', env: { DB_PORT: '1', DATABASE_URL: '' }, dbDown: true }
];

async function boot(env: Record<string, string>, port: number): Promise<ChildProcess> {
    const child = spawn('npx', ['vite', 'dev', '--port', String(port), '--strictPort'], {
        env: { ...process.env, ...env },
        stdio: 'ignore'
    });
    for (let i = 0; i < 120; i++) {
        try {
            const r = await fetch(`http://localhost:${port}/`, {
                signal: AbortSignal.timeout(2000)
            });
            if (r.ok) {
                return child;
            }
        } catch {
            /* not up yet */
        }
        await sleep(500);
    }
    child.kill();
    throw new Error(`server never answered on ${port}`);
}

interface Result {
    caseName: string;
    what: string;
    pass: boolean;
    detail: string;
}
const results: Result[] = [];
const check = (caseName: string, what: string, pass: boolean, detail = ''): number =>
    results.push({ caseName, what, pass, detail });

for (const [i, testCase] of CASES.entries()) {
    const port = PORT_BASE + i;
    const at = (path: string): string => `http://localhost:${port}${path}`;
    let child: ChildProcess;
    try {
        child = await boot(testCase.env, port);
    } catch (e) {
        check(testCase.name, 'server starts', false, String(e));
        continue;
    }

    try {
        const html = await (await fetch(at('/'))).text();
        const mail = Boolean(testCase.env.RESEND_API_KEY);
        const search = Boolean(testCase.env.TAVILY_API_KEY);

        check(testCase.name, 'the compose form renders', html.includes('Naming strategy'));

        // The address is asked for exactly where it can be used.
        const asksForAddress = html.includes('you@example.com');
        check(
            testCase.name,
            mail ? 'asks for an address' : 'does not ask for an address',
            asksForAddress === mail,
            `field ${asksForAddress ? 'present' : 'absent'}`
        );

        // The web check is offered exactly where something can answer it.
        const saysNoProvider = html.includes('No search provider is configured');
        check(
            testCase.name,
            search ? 'offers the web check' : 'says the web cannot be checked',
            saysNoProvider === !search,
            `notice ${saysNoProvider ? 'shown' : 'absent'}`
        );

        // /runs answers rather than failing, whatever the database is doing.
        const runs = await fetch(at('/runs'));
        check(testCase.name, 'the history page answers', runs.ok, `HTTP ${runs.status}`);

        if (testCase.dbDown) {
            check(
                testCase.name,
                'a dead database shows the form, not a 500',
                html.includes('Naming strategy')
            );
        } else {
            // A run with no address: accepted where mail is off, refused where it is on.
            const bare = await fetch(at('/api/runs'), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ...RUN, brief: `${MARK} bare`, email: '' })
            });
            const bareBody = await reply(bare);
            check(
                testCase.name,
                mail ? 'refuses a run with no address' : 'starts a run with no address',
                mail ? bare.status === 400 : bare.ok && bareBody.verified === true,
                `HTTP ${bare.status} ${JSON.stringify(bareBody).slice(0, 70)}`
            );

            if (mail) {
                // With one, it waits for a code rather than starting.
                const named = await fetch(at('/api/runs'), {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        ...RUN,
                        brief: `${MARK} addressed`,
                        email: 'env-matrix@example.com'
                    })
                });
                const namedBody = await reply(named);
                check(
                    testCase.name,
                    'holds an addressed run for verification',
                    named.ok && namedBody.verified === false,
                    `HTTP ${named.status} ${JSON.stringify(namedBody).slice(0, 70)}`
                );
            }

            /*
             * The web check is accepted exactly where it can be answered.
             *
             * Both halves matter. Refusing it without a provider is what stops
             * a thousand names queueing against a browser; accepting it with
             * one is the whole point of configuring a provider — and a guard
             * that refused both would be indistinguishable from a broken form.
             */
            const web = await fetch(at('/api/runs'), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    ...RUN,
                    brief: `${MARK} web`,
                    stores: ['appStore', 'google'],
                    requiredStores: ['appStore'],
                    requireGoogle: false,
                    email: mail ? 'env-matrix@example.com' : ''
                })
            });
            const webBody = await reply(web);
            check(
                testCase.name,
                search ? 'accepts a run that checks the web' : 'refuses a web check it cannot run',
                search
                    ? web.ok
                    : web.status === 400 && /search provider/i.test(webBody.message ?? ''),
                `HTTP ${web.status} ${JSON.stringify(webBody).slice(0, 70)}`
            );

            // A malformed run is refused in the app's own words, not zod's.
            const bad = await fetch(at('/api/runs'), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ...RUN, brief: 'too short' })
            });
            const badBody = await reply(bad);
            check(
                testCase.name,
                'refuses a short brief in plain words',
                bad.status === 400 && /brief/i.test(JSON.stringify(badBody)),
                `HTTP ${bad.status} ${JSON.stringify(badBody).slice(0, 70)}`
            );
        }
    } catch (e) {
        check(testCase.name, 'checks run without throwing', false, String(e));
    } finally {
        child.kill();
        await sleep(400);
    }
}

/*
 * Every run this made, gone again.
 *
 * A probe that leaves rows behind turns the history page into a list of tests
 * after a few runs of this, and the second run of it would be measuring a
 * database the first one dirtied.
 */
await db();
const probes = await Run.find({ where: { brief: Like(`${MARK}%`) } });
for (const probe of probes) {
    await Candidate.delete({ runId: probe.id });
    await Verification.delete({ runId: probe.id });
    await Run.delete({ id: probe.id });
}
console.log(`\ncleaned up ${probes.length} probe run${probes.length === 1 ? '' : 's'}`);

const failed = results.filter((r) => !r.pass);
let last = '';
for (const r of results) {
    if (r.caseName !== last) {
        console.log(`\n${r.caseName}`);
        last = r.caseName;
    }
    console.log(`  ${r.pass ? 'ok  ' : 'FAIL'} ${r.what}${r.pass ? '' : ` — ${r.detail}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
