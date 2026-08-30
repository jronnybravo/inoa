/**
 * Transactional mail through Resend.
 *
 * Two messages: a verification code, and the finished results. Both degrade
 * quietly — a run must never fail because mail could not be sent.
 */

import { Resend } from 'resend';
import { CHECK_LABEL, CHECK_ORDER, type CheckStatus } from '../types.ts';

const from = process.env.RESEND_FROM ?? 'Brandy <onboarding@resend.dev>';
const client = () => {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : undefined;
};

export async function sendVerificationCode(to: string, code: string): Promise<boolean> {
  const resend = client();
  if (!resend) return false;
  try {
    await resend.emails.send({
      from,
      to,
      subject: `${code} is your Brandy verification code`,
      text: `Your verification code is ${code}. It expires in 20 minutes.`
    });
    return true;
  } catch {
    return false;
  }
}

interface ResultRow {
  name: string;
  com: CheckStatus;
  appStore: CheckStatus;
  playStore: CheckStatus;
  google: CheckStatus;
}

const CELL: Record<CheckStatus, string> = {
  clear: 'free',
  taken: 'taken',
  unknown: 'not verified',
  skipped: '—',
  pending: '—'
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
): Promise<boolean> {
  const resend = client();
  if (!resend) return false;

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
    await resend.emails.send({
      from,
      to,
      subject: `${rows.length} names cleared for "${brief.slice(0, 40)}"`,
      html:
        `<p>Your naming run finished. <a href="${url}">Open the full results</a>.</p>` +
        `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">` +
        `<tr>${['Name', ...CHECK_ORDER.map((k) => CHECK_LABEL[k])]
          .map((h) => `<th align="left" style="padding:4px 10px">${h}</th>`)
          .join('')}</tr>${table}</table>` +
        (rows.length > 60 ? `<p>Showing 60 of ${rows.length}. Full list in the CSV.</p>` : ''),
      attachments: [
        { filename: `brandy-${runId.slice(0, 8)}.csv`, content: Buffer.from(toCsv(rows)).toString('base64') }
      ]
    });
    return true;
  } catch {
    return false;
  }
}
