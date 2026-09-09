/**
 * Issuing a verification code, in one place.
 *
 * A code is created twice: once when a run is composed, and once when somebody
 * asks for another because the first never arrived or has since expired. Both
 * sites have to agree on the digits, the lifetime, and the fact that the mail
 * failing is not the run failing — so they share this rather than each keeping
 * their own copy of a twenty-minute constant.
 */

import { randomInt } from 'node:crypto';
import { sendVerificationCode, type SendResult } from './email.ts';
import { Verification } from './entities/verification.ts';

/**
 * How long a code is good for.
 *
 * The number is also spoken aloud in the email, so it lives here and is read
 * from here rather than being written down twice and drifting.
 */
export const CODE_MINUTES = 20;

/**
 * Mint a fresh code for a run and try to mail it.
 *
 * Older codes for the same run are left where they are rather than deleted:
 * verification reads the newest one, so a superseded code stops working by
 * being superseded. Keeping the rows keeps the attempt history that bounds
 * how often a six-digit number can be guessed at.
 */
export async function issueCode(runId: string, email: string): Promise<SendResult> {
    // Six digits, from a CSPRNG rather than Math.random.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await Verification.create({
        runId,
        email,
        code,
        expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000)
    }).save();

    return sendVerificationCode(email, code, CODE_MINUTES);
}
