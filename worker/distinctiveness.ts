/**
 * Where a name sits on the Abercrombie spectrum.
 *
 * Two ends of the spectrum are decidable here, without asking anyone.
 *
 *   - A name with no dictionary root is invented, and an invented word is
 *     fanciful by definition. Nothing about the brief can change that.
 *   - A name built from the brief's own vocabulary is describing the category
 *     rather than naming it. 'Namevault' for a naming tool is descriptive
 *     however it is dressed up.
 *
 * The middle — suggestive against arbitrary — is the interesting distinction
 * and the one a dictionary cannot make, because it turns on whether the name
 * hints at the category. That judgement comes from the model during
 * generation, where the brief is already in hand and it costs no extra call.
 */

import { readFileSync } from 'node:fs';
import type { Distinctiveness } from '../src/lib/types.ts';

const WORD_LIST = '/usr/share/dict/words';

let dictionary: Set<string> | undefined;

/** The system word list, if this machine has one. */
function words(): Set<string> {
    if (dictionary) {
        return dictionary;
    }
    try {
        dictionary = new Set(
            readFileSync(WORD_LIST, 'utf8')
                .split('\n')
                .map((w) => w.trim().toLowerCase())
                .filter((w) => w.length >= 3)
        );
    } catch {
        // No word list: every name falls through to the model's judgement.
        dictionary = new Set();
    }
    return dictionary;
}

/**
 * Split a name into two dictionary words, if it is two words.
 *
 * Shortest first part first. Taking the longest split read 'Palethorn' as
 * 'palet + horn' — both real words, but not the reading anyone has — where
 * starting short finds 'pale + thorn'.
 */
export function splitIntoWords(name: string): [string, string] | null {
    const known = words();
    const lower = name.toLowerCase();
    for (let cut = 3; cut <= lower.length - 3; cut++) {
        const head = lower.slice(0, cut);
        const tail = lower.slice(cut);
        if (known.has(head) && known.has(tail)) {
            return [head, tail];
        }
    }
    return null;
}

/** The words a brief is about, for spotting a name that merely repeats them. */
export function briefVocabulary(brief: string): Set<string> {
    return new Set(
        brief
            .toLowerCase()
            .split(/[^a-z]+/)
            .filter((w) => w.length > 3)
    );
}

export interface Classified {
    distinctiveness: Distinctiveness;
    why: string;
}

/**
 * What can be decided without judgement. Null means ask the model.
 */
export function classifyLocally(name: string, vocabulary: Set<string>): Classified | null {
    const known = words();
    if (known.size === 0) {
        return null;
    }

    const lower = name.toLowerCase();
    const parts = splitIntoWords(name) ?? (known.has(lower) ? [lower] : null);

    if (!parts) {
        return {
            distinctiveness: 'fanciful',
            why: 'Invented: no dictionary word inside it'
        };
    }

    const echoes = parts.filter((part) => vocabulary.has(part));
    if (echoes.length === parts.length) {
        return {
            distinctiveness: 'generic',
            why: `Built entirely from the brief's own words: ${echoes.join(' + ')}`
        };
    }
    if (echoes.length > 0) {
        return {
            distinctiveness: 'descriptive',
            why: `Describes the category: '${echoes.join("', '")}' comes from the brief`
        };
    }

    // Real words that the brief never used. Whether that is suggestive or
    // arbitrary depends on meaning, which is the model's part.
    return null;
}
