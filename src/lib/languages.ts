/**
 * The languages a run may draw names from.
 *
 * 'Other languages' asked a model for anything foreign and took what came
 * back, which in practice meant Japanese and Latin every time — those are the
 * two a model reaches for unprompted. Naming the sources is the difference
 * between a brief that wants Nordic austerity and one that wants Bantu warmth.
 *
 * The form offers families only — twelve of them. It offered the families and
 * thirty-two single languages together, which is forty-four options for a
 * setting most runs leave empty, and 'Japanese' next to 'East Asian' asks
 * somebody to know the difference before they can pick either.
 *
 * The single entries stay in this list. They are how a run stored before the
 * change still resolves, and how an id somebody has in a link keeps working —
 * they are simply not among the things offered. LANGUAGE_GROUPS is what the
 * form shows; LANGUAGES is what anything looking an id up should read.
 *
 * Every single language here is inside a family, so nothing was lost by
 * narrowing the list — catalogs.test.ts fails if that ever stops being true.
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
    /**
     * Approximate speakers, in millions, first and second combined.
     *
     * Rounded hard and used only to order the list — the gap between Mandarin
     * and Icelandic is the information here, the gap between Italian and
     * Turkish is not. A family carries roughly the sum of its members.
     *
     * Speakers rather than 'how often a brand reaches for it', which would be
     * a guess dressed as data. It does put Latin & Greek near the bottom
     * despite their long history in brand names — the ordering is a default,
     * and typing three letters beats any hand-ranking.
     */
    speakers: number;
}

const KNOWN_LANGUAGES: LanguageChoice[] = [
    // Families first: the broad strokes somebody reaches for before a specific
    // language occurs to them.
    {
        id: 'romance',
        label: 'Romance',
        group: true,
        covers: ['Latin', 'Spanish', 'French', 'Italian', 'Portuguese', 'Romanian', 'Catalan'],
        speakers: 1100
    },
    {
        id: 'germanic',
        label: 'Germanic',
        group: true,
        covers: ['German', 'Dutch', 'Old English', 'Afrikaans'],
        speakers: 750
    },
    {
        id: 'nordic',
        label: 'Nordic',
        group: true,
        covers: ['Old Norse', 'Swedish', 'Danish', 'Norwegian', 'Icelandic', 'Finnish'],
        speakers: 25
    },
    {
        id: 'slavic',
        label: 'Slavic',
        group: true,
        covers: ['Russian', 'Polish', 'Czech', 'Ukrainian', 'Croatian'],
        speakers: 315
    },
    {
        id: 'classical',
        label: 'Latin & Greek',
        group: true,
        covers: ['Latin', 'Greek', 'Ancient Greek'],
        speakers: 15
    },
    {
        id: 'celtic',
        label: 'Celtic',
        group: true,
        covers: ['Irish', 'Welsh', 'Scottish Gaelic'],
        speakers: 3
    },
    {
        id: 'semitic',
        label: 'Semitic',
        group: true,
        covers: ['Arabic', 'Hebrew', 'Amharic'],
        speakers: 400
    },
    {
        id: 'bantu',
        label: 'Bantu',
        group: true,
        covers: ['Swahili', 'Zulu', 'Xhosa', 'Shona'],
        speakers: 350
    },
    {
        id: 'austronesian',
        label: 'Austronesian',
        group: true,
        covers: ['Tagalog', 'Indonesian', 'Malay', 'Hawaiian', 'Māori', 'Cebuano'],
        speakers: 380
    },
    {
        id: 'indic',
        label: 'Indic',
        group: true,
        covers: ['Sanskrit', 'Hindi', 'Bengali', 'Tamil', 'Urdu'],
        speakers: 1300
    },
    {
        id: 'east-asian',
        label: 'East Asian',
        group: true,
        covers: ['Japanese', 'Korean', 'Mandarin', 'Cantonese'],
        speakers: 1600
    },
    /*
     * Added when the form narrowed to families.
     *
     * Turkish was the one language in this file that belonged to no family —
     * fine while it was offered on its own, and a hole the moment the families
     * became the whole list. The word list has Turkish roots, so dropping it
     * would have left roots nothing could reach.
     */
    {
        id: 'turkic',
        label: 'Turkic',
        group: true,
        covers: ['Turkish', 'Azerbaijani', 'Uzbek', 'Kazakh', 'Turkmen', 'Kyrgyz'],
        speakers: 200
    },

    // Then the individual languages, for somebody who knows exactly what they
    // want. Ordered by how often a brand actually reaches for them.
    { id: 'japanese', label: 'Japanese', covers: ['Japanese'], speakers: 125 },
    { id: 'latin', label: 'Latin', covers: ['Latin'], speakers: 1 },
    { id: 'greek', label: 'Greek', covers: ['Greek', 'Ancient Greek'], speakers: 13 },
    { id: 'spanish', label: 'Spanish', covers: ['Spanish'], speakers: 560 },
    { id: 'italian', label: 'Italian', covers: ['Italian'], speakers: 65 },
    { id: 'french', label: 'French', covers: ['French'], speakers: 310 },
    { id: 'portuguese', label: 'Portuguese', covers: ['Portuguese'], speakers: 265 },
    { id: 'old-norse', label: 'Old Norse', covers: ['Old Norse'], speakers: 1 },
    { id: 'swedish', label: 'Swedish', covers: ['Swedish'], speakers: 13 },
    { id: 'danish', label: 'Danish', covers: ['Danish'], speakers: 6 },
    { id: 'norwegian', label: 'Norwegian', covers: ['Norwegian'], speakers: 5 },
    { id: 'icelandic', label: 'Icelandic', covers: ['Icelandic'], speakers: 1 },
    { id: 'finnish', label: 'Finnish', covers: ['Finnish'], speakers: 5 },
    { id: 'german', label: 'German', covers: ['German'], speakers: 135 },
    { id: 'dutch', label: 'Dutch', covers: ['Dutch'], speakers: 25 },
    { id: 'welsh', label: 'Welsh', covers: ['Welsh'], speakers: 1 },
    { id: 'irish', label: 'Irish', covers: ['Irish'], speakers: 2 },
    { id: 'arabic', label: 'Arabic', covers: ['Arabic'], speakers: 400 },
    { id: 'hebrew', label: 'Hebrew', covers: ['Hebrew'], speakers: 9 },
    { id: 'swahili', label: 'Swahili', covers: ['Swahili'], speakers: 200 },
    { id: 'zulu', label: 'Zulu', covers: ['Zulu'], speakers: 28 },
    { id: 'sanskrit', label: 'Sanskrit', covers: ['Sanskrit'], speakers: 1 },
    { id: 'hindi', label: 'Hindi', covers: ['Hindi'], speakers: 610 },
    { id: 'tagalog', label: 'Tagalog', covers: ['Tagalog'], speakers: 85 },
    { id: 'indonesian', label: 'Indonesian', covers: ['Indonesian'], speakers: 200 },
    { id: 'hawaiian', label: 'Hawaiian', covers: ['Hawaiian'], speakers: 1 },
    { id: 'maori', label: 'Māori', covers: ['Māori'], speakers: 1 },
    { id: 'korean', label: 'Korean', covers: ['Korean'], speakers: 82 },
    { id: 'mandarin', label: 'Mandarin', covers: ['Mandarin'], speakers: 1100 },
    { id: 'turkish', label: 'Turkish', covers: ['Turkish'], speakers: 90 },
    { id: 'russian', label: 'Russian', covers: ['Russian'], speakers: 255 },
    { id: 'polish', label: 'Polish', covers: ['Polish'], speakers: 40 }
];

/**
 * Most spoken first, families and single languages interleaved.
 *
 * Sorted rather than hand-ordered, so a new entry lands where its size puts it
 * instead of wherever it was typed — the same treatment the domains and the
 * platforms get.
 */
export const LANGUAGES: readonly LanguageChoice[] = [...KNOWN_LANGUAGES].sort(
    (a, b) => b.speakers - a.speakers || a.label.localeCompare(b.label)
);

/**
 * The families, which is what the form offers.
 *
 * Derived rather than kept as a second list, so a family added above is
 * offered without anyone remembering to add it here twice.
 */
export const LANGUAGE_GROUPS: readonly LanguageChoice[] = LANGUAGES.filter((l) => l.group);

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
