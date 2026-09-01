/**
 * Transactional mail through Resend.
 *
 * Two messages: a verification code, and the finished results. Both degrade
 * quietly — a run must never fail because mail could not be sent.
 *
 * The SDK does NOT throw on a rejected send. It resolves with `{ data, error }`,
 * so a try/catch alone reports success on a 403 and the caller cheerfully says
 * the mail went out. Every send here checks the returned error and passes the
 * reason back, because "we could not tell you" must not look like "we told you".
 */

import { Resend } from 'resend';
import { CHECK_LABEL, CHECK_ORDER, type CheckStatus } from '../types.ts';

const from = process.env.RESEND_FROM ?? 'Branderist <onboarding@resend.dev>';
const client = () => {
    const key = process.env.RESEND_API_KEY;
    return key ? new Resend(key) : undefined;
};

export interface SendResult {
    sent: boolean;
    reason?: string;
}

export async function sendVerificationCode(to: string, code: string): Promise<SendResult> {
    const resend = client();
    if (!resend) {
        return { sent: false, reason: 'No RESEND_API_KEY configured' };
    }
    try {
        const { error } = await resend.emails.send({
            from,
            to,
            subject: `${code} is your verification code`,
            text: `Your verification code is ${code}. It expires in 20 minutes.`
        });
        if (error) {
            return { sent: false, reason: error.message };
        }
        return { sent: true };
    } catch (e) {
        return { sent: false, reason: (e as Error).message };
    }
}

interface ResultRow {
    name: string;
    com: CheckStatus;
    appStore: CheckStatus;
    playStore: CheckStatus;
    google: CheckStatus;
}

/** The same words the page uses; a CSV row should not need the page to read. */
const CELL: Record<CheckStatus, string> = {
    clear: 'free',
    taken: 'taken',
    unknown: 'not verified',
    skipped: 'skipped',
    pending: 'waiting'
};

export function toCsv(rows: ResultRow[]): string {
    const header = ['Name', ...CHECK_ORDER.map((k) => CHECK_LABEL[k])].join(',');
    const body = rows.map((r) =>
        [r.name, ...CHECK_ORDER.map((k) => CELL[r[k]])].map((v) => `"${v}"`).join(',')
    );
    return [header, ...body].join('\n');
}

export async function sendResults(
    to: string,
    runId: string,
    brief: string,
    rows: ResultRow[],
    url: string
): Promise<SendResult> {
    const resend = client();
    if (!resend) {
        return { sent: false, reason: 'No RESEND_API_KEY configured' };
    }

    const table = rows
        .slice(0, 60)
        .map(
            (r) =>
                `<tr><td style="padding:4px 10px"><b>${r.name}</b></td>` +
                CHECK_ORDER.map((k) => `<td style="padding:4px 10px">${CELL[r[k]]}</td>`).join('') +
                '</tr>'
        )
        .join('');

    try {
        const { error } = await resend.emails.send({
            from,
            to,
            subject: `${rows.length} names cleared for "${brief.slice(0, 40)}"`,
            html:
                `<p>Your naming run finished. <a href="${url}">Open the full results</a>.</p>` +
                `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">` +
                `<tr>${['Name', ...CHECK_ORDER.map((k) => CHECK_LABEL[k])]
                    .map((h) => `<th align="left" style="padding:4px 10px">${h}</th>`)
                    .join('')}</tr>${table}</table>` +
                (rows.length > 60
                    ? `<p>Showing 60 of ${rows.length}. Full list in the CSV.</p>`
                    : ''),
            attachments: [
                {
                    filename: `names-${runId.slice(0, 8)}.csv`,
                    // Resend's types accept a string here; the base64 form is
                    // what its API documents for an attachment.
                    content: Buffer.from(toCsv(rows), 'utf8').toString('base64')
                }
            ]
        });
        if (error) {
            return { sent: false, reason: error.message };
        }
        return { sent: true };
    } catch (e) {
        return { sent: false, reason: (e as Error).message };
    }
}
