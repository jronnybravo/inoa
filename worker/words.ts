/**
 * The vocabulary the deterministic generator builds from.
 *
 * Written into the repository rather than fetched, because the whole point of
 * this path is that it works with no key, no subscription and no network. The
 * thesaurus in offline.ts improves on these words when it can reach one; these
 * are what remains when it cannot, and they have to be good enough on their
 * own.
 *
 * Chosen for how they behave in a name rather than for meaning: short, mostly
 * one or two syllables, no awkward clusters at either end, and few that are
 * already somebody's trademark.
 */

/** Concrete things, for the first half of a compound. */
export const SUBSTANCE = [
    'iron',
    'stone',
    'ember',
    'cedar',
    'copper',
    'amber',
    'slate',
    'flint',
    'birch',
    'quartz',
    'basalt',
    'maple',
    'willow',
    'harbor',
    'meadow',
    'summit',
    'river',
    'delta',
    'canyon',
    'ridge',
    'harvest',
    'orchard',
    'thicket',
    'grove',
    'field',
    'anchor',
    'lantern',
    'compass',
    'beacon',
    'forge',
    'kiln',
    'loom',
    'atlas',
    'keystone',
    'cinder',
    'frost',
    'tide',
    'north',
    'terra'
];

/** Qualities, for the second half, or on their own. */
export const QUALITY = [
    'swift',
    'bright',
    'clear',
    'true',
    'warm',
    'wild',
    'still',
    'deep',
    'keen',
    'bold',
    'plain',
    'quick',
    'sure',
    'fair',
    'wide',
    'high',
    'first',
    'even',
    'ready',
    'steady'
];

/** Endings that read as a company rather than a word. */
export const ENDING = [
    'works',
    'forge',
    'craft',
    'field',
    'line',
    'lane',
    'gate',
    'port',
    'yard',
    'house',
    'stead',
    'wright',
    'smith',
    'bloom',
    'spark',
    'drift',
    'wave',
    'peak',
    'path',
    'well'
];

/** Evocative nouns for the metaphor approach — a name that means something. */
export const METAPHOR = [
    'lodestar',
    'cadence',
    'tide',
    'meridian',
    'compass',
    'keystone',
    'anchor',
    'beacon',
    'harbinger',
    'threshold',
    'crucible',
    'lantern',
    'almanac',
    'sextant',
    'plumbline',
    'watershed',
    'headwater',
    'bellwether',
    'touchstone',
    'waypoint',
    'wellspring',
    'polestar',
    'daybreak',
    'foothold',
    'groundwork',
    'undertow',
    'aurora',
    'zenith',
    'equinox',
    'solstice'
];

/**
 * Roots from other languages, with what they mean.
 *
 * The gloss is not decoration: a name built from a word somebody cannot
 * translate is a name they cannot explain to an investor, and the rationale
 * this generator writes is the only place that explanation exists.
 */
export const FOREIGN: readonly { word: string; gloss: string; from: string }[] = [
    { word: 'kizuna', gloss: 'bond', from: 'Japanese' },
    { word: 'mori', gloss: 'forest', from: 'Japanese' },
    { word: 'hikari', gloss: 'light', from: 'Japanese' },
    { word: 'nagare', gloss: 'flow', from: 'Japanese' },
    { word: 'lumen', gloss: 'light', from: 'Latin' },
    { word: 'terra', gloss: 'earth', from: 'Latin' },
    { word: 'sequi', gloss: 'to follow', from: 'Latin' },
    { word: 'novus', gloss: 'new', from: 'Latin' },
    { word: 'certus', gloss: 'settled', from: 'Latin' },
    { word: 'vera', gloss: 'true', from: 'Latin' },
    { word: 'kairos', gloss: 'the right moment', from: 'Greek' },
    { word: 'kosmos', gloss: 'order', from: 'Greek' },
    { word: 'techne', gloss: 'craft', from: 'Greek' },
    { word: 'arche', gloss: 'beginning', from: 'Greek' },
    { word: 'vindr', gloss: 'wind', from: 'Old Norse' },
    { word: 'skara', gloss: 'to cut clean', from: 'Old Norse' },
    { word: 'bru', gloss: 'bridge', from: 'Old Norse' },
    { word: 'sonder', gloss: 'apart', from: 'Danish' },
    { word: 'vinden', gloss: 'the wind', from: 'Swedish' },
    { word: 'campo', gloss: 'field', from: 'Spanish' },
    { word: 'cosecha', gloss: 'harvest', from: 'Spanish' },
    { word: 'fuente', gloss: 'source', from: 'Spanish' },
    { word: 'chemin', gloss: 'path', from: 'French' },
    { word: 'clairon', gloss: 'clarion', from: 'French' },
    { word: 'ponte', gloss: 'bridge', from: 'Italian' },
    { word: 'raiz', gloss: 'root', from: 'Portuguese' },

    /*
     * The families the first draft could not reach.
     *
     * Eleven families are offered and only four had a root here, so choosing
     * Bantu or Semitic with no model configured returned nothing at all — a
     * short batch and no error anywhere. catalogs.test.ts now fails if a
     * family is ever offered without something to build from.
     */
    { word: 'wald', gloss: 'forest', from: 'German' },
    { word: 'quelle', gloss: 'source', from: 'German' },
    { word: 'hafen', gloss: 'harbour', from: 'German' },
    { word: 'licht', gloss: 'light', from: 'Dutch' },
    { word: 'haven', gloss: 'harbour', from: 'Dutch' },
    { word: 'brug', gloss: 'bridge', from: 'Dutch' },
    { word: 'holt', gloss: 'a wood', from: 'Old English' },
    { word: 'stede', gloss: 'place', from: 'Old English' },

    { word: 'mir', gloss: 'peace, and the world', from: 'Russian' },
    { word: 'reka', gloss: 'river', from: 'Russian' },
    { word: 'iskra', gloss: 'spark', from: 'Polish' },

    { word: 'dara', gloss: 'oak', from: 'Irish' },
    { word: 'sona', gloss: 'happy', from: 'Irish' },
    { word: 'afon', gloss: 'river', from: 'Welsh' },
    { word: 'glan', gloss: 'shore', from: 'Welsh' },
    { word: 'loch', gloss: 'lake', from: 'Scottish Gaelic' },

    { word: 'nur', gloss: 'light', from: 'Arabic' },
    { word: 'amal', gloss: 'hope', from: 'Arabic' },
    { word: 'bahr', gloss: 'sea', from: 'Arabic' },
    { word: 'aviv', gloss: 'spring', from: 'Hebrew' },
    { word: 'gal', gloss: 'wave', from: 'Hebrew' },

    { word: 'safari', gloss: 'journey', from: 'Swahili' },
    { word: 'nuru', gloss: 'light', from: 'Swahili' },
    { word: 'imara', gloss: 'steady', from: 'Swahili' },
    { word: 'langa', gloss: 'sun', from: 'Zulu' },
    { word: 'amanzi', gloss: 'water', from: 'Zulu' },

    { word: 'tala', gloss: 'star', from: 'Tagalog' },
    { word: 'alon', gloss: 'wave', from: 'Tagalog' },
    { word: 'bukid', gloss: 'field', from: 'Tagalog' },
    { word: 'laut', gloss: 'sea', from: 'Indonesian' },
    { word: 'cahaya', gloss: 'light', from: 'Indonesian' },
    { word: 'kai', gloss: 'sea', from: 'Hawaiian' },
    { word: 'lani', gloss: 'sky', from: 'Hawaiian' },
    { word: 'awa', gloss: 'river', from: 'Māori' },
    { word: 'moana', gloss: 'ocean', from: 'Māori' },

    { word: 'veda', gloss: 'knowledge', from: 'Sanskrit' },
    { word: 'agni', gloss: 'fire', from: 'Sanskrit' },
    { word: 'nadi', gloss: 'river', from: 'Sanskrit' },
    { word: 'asha', gloss: 'hope', from: 'Hindi' },
    { word: 'surya', gloss: 'sun', from: 'Hindi' },

    { word: 'bada', gloss: 'sea', from: 'Korean' },
    { word: 'saem', gloss: 'a spring', from: 'Korean' },
    { word: 'lin', gloss: 'forest', from: 'Mandarin' },
    { word: 'feng', gloss: 'wind', from: 'Mandarin' },
    { word: 'shan', gloss: 'mountain', from: 'Mandarin' },

    { word: 'deniz', gloss: 'sea', from: 'Turkish' },
    { word: 'ada', gloss: 'island', from: 'Turkish' },

    { word: 'metsa', gloss: 'forest', from: 'Finnish' },
    { word: 'aalto', gloss: 'wave', from: 'Finnish' },
    { word: 'valo', gloss: 'light', from: 'Finnish' },
    { word: 'lind', gloss: 'a spring', from: 'Icelandic' },
    { word: 'birta', gloss: 'brightness', from: 'Icelandic' },
    { word: 'fjell', gloss: 'mountain', from: 'Norwegian' },
    { word: 'elv', gloss: 'river', from: 'Norwegian' }
];

/**
 * The pieces invented names are assembled from.
 *
 * Onsets and codas that a reader can pronounce on sight, which is the only
 * property that matters here: an invented name has no meaning to fall back on,
 * so if it cannot be said aloud it cannot be told to anyone.
 */
export const ONSET = [
    'b',
    'br',
    'c',
    'cl',
    'cr',
    'd',
    'dr',
    'f',
    'fl',
    'fr',
    'g',
    'gl',
    'gr',
    'h',
    'j',
    'k',
    'kr',
    'l',
    'm',
    'n',
    'p',
    'pl',
    'pr',
    'qu',
    'r',
    's',
    'sk',
    'sl',
    'sn',
    'sp',
    'st',
    'str',
    't',
    'tr',
    'v',
    'w',
    'z'
];

export const NUCLEUS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ea', 'io', 'ou', 'ia', 'au', 'ei'];

export const CODA = ['n', 'r', 'l', 'm', 's', 'x', 'v', 'th', 'nd', 'rn', 'sk', 'ph', 'nt'];

/** Endings that make an invented stem read as a name rather than a syllable. */
export const INVENTED_TAIL = [
    'a',
    'o',
    'is',
    'us',
    'ex',
    'ix',
    'on',
    'an',
    'ia',
    'io',
    'os',
    'ora',
    'ova',
    'yne',
    'eo'
];

/**
 * Words too common to build a brand on.
 *
 * Not a profanity filter — a plainness filter. 'The Data Company' is not a
 * name, and a compound of two of these reads the same way.
 */
export const TOO_PLAIN = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'have',
    'has',
    'are',
    'was',
    'will',
    'app',
    'apps',
    'data',
    'tech',
    'system',
    'systems',
    'service',
    'services',
    'platform',
    'solution',
    'solutions',
    'company',
    'business',
    'product',
    'products',
    'online',
    'digital',
    'software',
    'website',
    'internet',
    'network',
    'user',
    'users',
    'customer',
    'customers',
    'market',
    'markets',
    'team',
    'teams',
    'work',
    'works',
    'thing',
    'things',
    'people',
    'person',
    'time',
    'times',
    'way',
    'ways',
    'new',
    'good',
    'best',
    'more',
    'most',
    'very',
    'much'
]);

/**
 * Can a reader say this on sight?
 *
 * Three consonants in a row is where a made-up word stops being sayable, with
 * the exception of the clusters English already uses. Cheap and approximate,
 * which is the right trade for something applied to tens of thousands of
 * candidates.
 */
const SAYABLE_CLUSTERS = ['str', 'spr', 'scr', 'thr', 'shr', 'nth', 'rst', 'nds', 'ngth'];

export function pronounceable(word: string): boolean {
    const lower = word.toLowerCase();
    if (!/^[a-z]+$/.test(lower) || lower.length < 3 || lower.length > 12) {
        return false;
    }
    if (!/[aeiouy]/.test(lower)) {
        return false;
    }
    /*
     * Three vowels in a row is the other way a made-up word stops being
     * sayable, and the assembler reaches it easily: a two-letter nucleus and a
     * two-letter tail meet as 'Quioeo'. Consonants were checked from the
     * start; this half was missing, and it produced the worst names in the
     * first run of the offline generator.
     */
    if (/[aeiou]{3,}/.test(lower)) {
        return false;
    }
    const runs = lower.match(/[^aeiouy]{3,}/g) ?? [];
    return runs.every((run) => SAYABLE_CLUSTERS.some((ok) => run.includes(ok)));
}

/**
 * The longest a word can be and still take a second half.
 *
 * 'Residenthicket' and 'Interfacebloom' are both two reasonable words and one
 * unusable name. A compound has a budget, and most of it has to go on the part
 * that carries the meaning.
 */
export const MAX_PART = 7;

/**
 * Short words that are already something else.
 *
 * The short-and-abstract rule assembles three to five letters and now and then
 * lands on a prefix or an ordinary word — 'Pre', 'Sub', 'Ion'. They are not
 * inventions, and a shortlist is not improved by having one in it.
 */
export const NOT_A_NAME = new Set([
    'pre',
    'sub',
    'non',
    'via',
    'per',
    'pro',
    'con',
    'ion',
    'ans',
    'ers',
    'est',
    'ing',
    'ism',
    'ist',
    'ity',
    'ous',
    'the',
    'and',
    'but',
    'not',
    'you',
    'was',
    'are',
    'has',
    'had',
    'his',
    'her',
    'its',
    'our',
    'out',
    'one',
    'two',
    'six',
    'ten',
    'new',
    'old',
    'own',
    'off',
    'yes'
]);
