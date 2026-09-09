/**
 * The languages a run may draw names from.
 *
 * 'Other languages' asked a model for anything foreign and took what came
 * back, which in practice meant Japanese and Latin every time — those are the
 * two a model reaches for unprompted. Naming the sources is the difference
 * between a brief that wants Nordic austerity and one that wants Bantu warmth.
 *
 * Groups and single languages in one list on purpose. Somebody either knows
 * exactly what they want ('Japanese') or knows the flavour ('Romance'), and
 * making them pick five languages to express the second is a worse control
 * than offering the family.
 *
 * `covers` is the list a group expands to, and it is what the deterministic
 * generator matches its word list against — so the names there and the names
 * here have to agree exactly.
 */

export interface LanguageChoice {
    id: string;
    label: string;
    /** A family, rather than a single language. */
    group?: boolean;
    /** The languages this stands for. A single language covers itself. */
    covers: string[];
}

export const LANGUAGES: readonly LanguageChoice[] = [
    // Families first: the broad strokes somebody reaches for before a specific
    // language occurs to them.
    {
        id: 'romance',
        label: 'Romance',
        group: true,
        covers: ['Latin', 'Spanish', 'French', 'Italian', 'Portuguese', 'Romanian', 'Catalan']
    },
    {
        id: 'germanic',
        label: 'Germanic',
        group: true,
        covers: ['German', 'Dutch', 'Old English', 'Afrikaans']
    },
    {
        id: 'nordic',
        label: 'Nordic',
        group: true,
        covers: ['Old Norse', 'Swedish', 'Danish', 'Norwegian', 'Icelandic', 'Finnish']
    },
    {
        id: 'slavic',
        label: 'Slavic',
        group: true,
        covers: ['Russian', 'Polish', 'Czech', 'Ukrainian', 'Croatian']
    },
    {
        id: 'classical',
        label: 'Latin & Greek',
        group: true,
        covers: ['Latin', 'Greek', 'Ancient Greek']
    },
    { id: 'celtic', label: 'Celtic', group: true, covers: ['Irish', 'Welsh', 'Scottish Gaelic'] },
    { id: 'semitic', label: 'Semitic', group: true, covers: ['Arabic', 'Hebrew', 'Amharic'] },
    {
        id: 'bantu',
        label: 'Bantu',
        group: true,
        covers: ['Swahili', 'Zulu', 'Xhosa', 'Shona']
    },
    {
        id: 'austronesian',
        label: 'Austronesian',
        group: true,
        covers: ['Tagalog', 'Indonesian', 'Malay', 'Hawaiian', 'Māori', 'Cebuano']
    },
    {
        id: 'indic',
        label: 'Indic',
        group: true,
        covers: ['Sanskrit', 'Hindi', 'Bengali', 'Tamil', 'Urdu']
    },
    {
        id: 'east-asian',
        label: 'East Asian',
        group: true,
        covers: ['Japanese', 'Korean', 'Mandarin', 'Cantonese']
    },

    // Then the individual languages, for somebody who knows exactly what they
    // want. Ordered by how often a brand actually reaches for them.
    { id: 'japanese', label: 'Japanese', covers: ['Japanese'] },
    { id: 'latin', label: 'Latin', covers: ['Latin'] },
    { id: 'greek', label: 'Greek', covers: ['Greek', 'Ancient Greek'] },
    { id: 'spanish', label: 'Spanish', covers: ['Spanish'] },
    { id: 'italian', label: 'Italian', covers: ['Italian'] },
    { id: 'french', label: 'French', covers: ['French'] },
    { id: 'portuguese', label: 'Portuguese', covers: ['Portuguese'] },
    { id: 'old-norse', label: 'Old Norse', covers: ['Old Norse'] },
    { id: 'swedish', label: 'Swedish', covers: ['Swedish'] },
    { id: 'danish', label: 'Danish', covers: ['Danish'] },
    { id: 'norwegian', label: 'Norwegian', covers: ['Norwegian'] },
    { id: 'icelandic', label: 'Icelandic', covers: ['Icelandic'] },
    { id: 'finnish', label: 'Finnish', covers: ['Finnish'] },
    { id: 'german', label: 'German', covers: ['German'] },
    { id: 'dutch', label: 'Dutch', covers: ['Dutch'] },
    { id: 'welsh', label: 'Welsh', covers: ['Welsh'] },
    { id: 'irish', label: 'Irish', covers: ['Irish'] },
    { id: 'arabic', label: 'Arabic', covers: ['Arabic'] },
    { id: 'hebrew', label: 'Hebrew', covers: ['Hebrew'] },
    { id: 'swahili', label: 'Swahili', covers: ['Swahili'] },
    { id: 'zulu', label: 'Zulu', covers: ['Zulu'] },
    { id: 'sanskrit', label: 'Sanskrit', covers: ['Sanskrit'] },
    { id: 'hindi', label: 'Hindi', covers: ['Hindi'] },
    { id: 'tagalog', label: 'Tagalog', covers: ['Tagalog'] },
    { id: 'indonesian', label: 'Indonesian', covers: ['Indonesian'] },
    { id: 'hawaiian', label: 'Hawaiian', covers: ['Hawaiian'] },
    { id: 'maori', label: 'Māori', covers: ['Māori'] },
    { id: 'korean', label: 'Korean', covers: ['Korean'] },
    { id: 'mandarin', label: 'Mandarin', covers: ['Mandarin'] },
    { id: 'turkish', label: 'Turkish', covers: ['Turkish'] },
    { id: 'russian', label: 'Russian', covers: ['Russian'] },
    { id: 'polish', label: 'Polish', covers: ['Polish'] }
];

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));

export const isLanguage = (id: string): boolean => BY_ID.has(id);

export const language = (id: string): LanguageChoice | undefined => BY_ID.get(id);

/**
 * The languages a selection actually stands for.
 *
 * An empty selection means every language, which is the default and the
 * honest reading of 'Other languages' with nothing narrowed — so it returns
 * an empty list and callers treat that as 'no constraint' rather than 'none'.
 */
export function languagesCovered(ids: string[]): string[] {
    const out = new Set<string>();
    for (const id of ids) {
        for (const name of BY_ID.get(id)?.covers ?? []) {
            out.add(name);
        }
    }
    return [...out];
}
