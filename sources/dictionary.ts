/**
 * Dictionary source.
 *
 * Two jobs: tell us whether a string is already a real English word (which
 * decides whether a candidate is 'real-word' or 'invented', and heavily affects
 * how ownable it is), and pull definitions for words we want to mine.
 *
 * The local system word list is the fast path; dictionaryapi.dev supplies
 * definitions when the network is available.
 */

import { readFile } from 'node:fs/promises';
import { getJSON } from '../core/net.ts';
import { normalize } from '../core/text.ts';
import type { Seed } from '../core/types.ts';

const SYSTEM_WORDLISTS = ['/usr/share/dict/words', '/usr/dict/words'];

/** A fallback so real-word detection still works without a system dictionary. */
const FALLBACK_WORDS = `
able about above accept access account across act add advance after age agent air alert all alloy
almanac alpha amber anchor angle anvil apex arbor arc arch archive area arena argument arrow art
aspect atlas atom aura autumn avenue axis badge balance band bank bar base basin batch beacon beam
bearing bell belt bench berry bind birch blade blend bliss block bloom blue board bold bolt bond
bonus book boost border bound box brace braid branch brand brass brave bread break breeze brick
bridge brief bright brim broad bronze brook brush build bulk bundle burst cabin cable cadence calm
camp canopy canvas cape card care carve cast catch cause cave cedar cell center chain chair chalk
chamber champion change channel chapter charge chart chase check chief chime choice chord circle
citadel city civic claim clarity class clay clean clear cliff climb cloud clover club coast coat
code coil coin cold color column comb combine comet comfort common compass compose concert
conduit connect const contact core corner cost cotton count course court cove cover craft crane
crate creek crest crew crisp crop cross crown crystal cue current curve cycle dale dart dash data
dawn day deal decade deck deep deer delta demand depth desk detail dial diamond dial dice dime
direct disc dish dive dock dome door dot double dove down draft drake draw dream drift drive drop
drum dune dusk duty eager eagle earth ease east echo edge elder elm ember empire enact end engine
enter equal era essence estate ether even event ever exact exit fable fabric face fact fair falcon
fall family fan far farm fast fathom favor feather feed fern ferry field figure file fill film
filter fine finish fir fire firm first fish fit five fix flag flame flare flash flat fleet flight
flint float flock floor flora flow flower flux focus fold folk font force ford forge form fort
forum found fountain frame free fresh friend front frost fruit fuel full fund fuse gain gale
gallery game gap garden gate gather gauge gear gem gift glacier glade glass gleam glide globe
glory glow gold golden good grace grade grain grand granite grant graph grasp grass gravel great
green grid grip grove growth guard guide gulf gust habit hall halo hand harbor harvest hatch haven
hawk hay hazel head hearth heart heat hedge helm herald hero hill hinge hive hold hollow home
honey hook hope horizon horn host hour house hub hue human hunt hurdle ice idea image impact index
ingot inlet inner input insight instant iron island issue ivory ivy jade jasper jet join joint
journey joy judge juniper keel keen keep kernel key kiln kin kind kite knot lab labor lace lake
lamp land lane lantern lap larch large lark laser latch launch laurel law layer lead leaf league
lean leap ledge legacy lens level lever light lily limb lime line link lion list lively local lock
lodge loft log logic long look loom loop lord lore lotus lucid luck lumen lunar lyric magnet main
make manor map maple marble march marina mark market marsh mask mason mast match matrix meadow
measure medal media mend merit mesa mesh metal meter method mica middle mild mile mill mind mine
mint mirror mist model modern module moment monarch moon moor moral more morning mosaic moss motion
motto mound mount move muse music muster myriad myth nail name native nature near nectar needle
nest net network never new next niche night nimbus noble node noon north note nova now number oak
oasis oath object ocean octave odyssey offer olive omega onward opal open opera optic orbit orchard
order ore organ origin osprey otter outer oval oxide pace pack page paint pair palace pale palm
panel paper parade parcel park part pass patch path patron pattern pause pearl pebble pen pennant
period phase phoenix pilot pine pioneer pitch pivot place plain plan plane plant plate play plaza
plume point polar pole pond pool port portal post pouch power prairie praise press prime print
prism prize probe process prompt proof proper prospect proud prove public pulse pump pure purple
quarry quartz quest quick quiet quill quilt quota radar radiant radius raft rail rain raise rally
ramp range rank rapid rare ray reach read realm reason record red reed reef refine relay relic
remedy render renew rent rescue reserve resin resolve rest result return ridge rift right rim ring
rise risk river road robin rock rocket rod rogue role roll roof room root rope rose round route
row royal rudder rule run rune rural rush safe saga sail saint salt sand sap sash satin save
scale scan scape scarlet scene scent scholar school scope score scout screen scribe scroll sea
seal search season seat second secret section seed seek segment select sense sentry sequel series
serve session set settle shade shaft shape share sharp shed sheen shelf shell shelter shield shift
shine ship shore short shoulder show shrine side sight sigma sign signal silk silver simple sing
single site six size sketch skill sky slate sleek slice slope small smart smith smoke smooth snow
socket soft soil solar sole solid solo solve song soul sound source south space span spare spark
speak spear speed spell sphere spice spike spin spire spirit split spoke spool spring sprout spur
square stack staff stage stair stake stand star start state station steady steam steel stem step
stern stick still stir stitch stock stone stop store storm story strand stream street stretch
strike string strong struct study style summit sun sunset supply support sure surf surge survey
swan sweep swift swim switch sword symbol table tack tact tail take tale talent talk tally tandem
tangent tank tap tape target task taste teach team tempo tender tent term terrace test text
texture thaw theme thicket thing think third thorn thread three threshold thrive throne tide tidy
tie tiger tile timber time tin tint tissue title token tone tool top torch total touch tour tower
town trace track trade trail train trait tram transit trap travel tray treasure tree trek trellis
trend trial tribe trim trio trove true trunk trust truth tune tunnel turn twin twist type union
unit unite unity urban usage use vale valley value valve vane vantage vapor vault vector veil
vein velvet vent venture verge verse vessel vest via vibe view vigil villa vine vintage violet
virtue vision visit vista vital vivid vocal voice void volume voyage wagon wake walk wall wander
warm warp wash watch water wave wax way weave web wedge weight well west wharf wheat wheel whisk
white whole wide wild will willow win wind window wing winter wire wise wish wit wolf wonder wood
word work world worth wren wright wright write yard year yield young zenith zephyr zeal zone
`.trim().split(/\s+/);

let wordSetPromise: Promise<Set<string>> | undefined;
let commonWordPromise: Promise<Set<string>> | undefined;

/** Lazily loaded set of real English words. */
export async function wordSet(): Promise<Set<string>> {
  wordSetPromise ??= (async () => {
    for (const path of SYSTEM_WORDLISTS) {
      try {
        const raw = await readFile(path, 'utf8');
        const set = new Set<string>();
        for (const line of raw.split('\n')) {
          const w = normalize(line);
          if (w.length >= 2) set.add(w);
        }
        if (set.size > 1000) {
          for (const w of FALLBACK_WORDS) set.add(w);
          return set;
        }
      } catch {
        // Try the next path.
      }
    }
    return new Set(FALLBACK_WORDS);
  })();
  return wordSetPromise;
}

/**
 * Words that appear in the system list in lowercase form.
 *
 * `wordSet` lowercases everything, so it cannot tell 'Mayo' the county from
 * 'mayo' the word — and Datamuse happily returns Mayo, Siena, Chennai and
 * Daytona when asked about 'places'. Keeping the original casing separates
 * proper nouns from common nouns, which is the difference between naming
 * material and noise.
 */
export async function commonWords(): Promise<Set<string>> {
  commonWordPromise ??= (async () => {
    for (const path of SYSTEM_WORDLISTS) {
      try {
        const raw = await readFile(path, 'utf8');
        const set = new Set<string>();
        for (const line of raw.split('\n')) {
          const word = line.trim();
          if (word.length >= 2 && /^[a-z]+$/.test(word)) set.add(word);
        }
        if (set.size > 10000) return set;
      } catch {
        // Try the next path.
      }
    }
    // No system dictionary: return empty, which callers read as "cannot judge"
    // and skip the filter rather than rejecting everything.
    return new Set<string>();
  })();
  return commonWordPromise;
}

/**
 * Is this a common noun rather than a proper noun or an abbreviation?
 * Returns true when we have no dictionary to judge with.
 */
export async function isCommonWord(word: string): Promise<boolean> {
  const set = await commonWords();
  if (set.size === 0) return true;
  const w = normalize(word);
  if (set.has(w)) return true;
  if (w.endsWith('s') && set.has(w.slice(0, -1))) return true;
  return false;
}

export async function isRealWord(word: string): Promise<boolean> {
  const set = await wordSet();
  const w = normalize(word);
  if (set.has(w)) return true;
  // Cheap morphology: plurals and past tenses are still 'real'.
  if (w.endsWith('s') && set.has(w.slice(0, -1))) return true;
  if (w.endsWith('ed') && set.has(w.slice(0, -2))) return true;
  if (w.endsWith('ing') && set.has(w.slice(0, -3))) return true;
  return false;
}

/** How many real English words start with this string — a rough familiarity signal. */
export async function prefixFamiliarity(prefix: string): Promise<number> {
  const set = await wordSet();
  const p = normalize(prefix);
  if (p.length < 3) return 0;
  let count = 0;
  for (const w of set) {
    if (w.startsWith(p)) {
      count++;
      if (count > 50) break;
    }
  }
  return count;
}

interface DictApiEntry {
  word: string;
  meanings: { partOfSpeech: string; definitions: { definition: string }[] }[];
}

export interface Definition {
  word: string;
  partOfSpeech: string;
  definition: string;
}

/** Definitions from dictionaryapi.dev. Empty when offline or unknown. */
export async function define(word: string): Promise<Definition[]> {
  const w = normalize(word);
  if (!w) return [];
  const data = await getJSON<DictApiEntry[]>(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`,
    { cacheFailures: true },
  );
  if (!Array.isArray(data)) return [];
  const out: Definition[] = [];
  for (const entry of data) {
    for (const meaning of entry.meanings ?? []) {
      const first = meaning.definitions?.[0];
      if (first) out.push({ word: w, partOfSpeech: meaning.partOfSpeech, definition: first.definition });
    }
  }
  return out.slice(0, 4);
}

/** A word plus its definitions, as generator input. */
export async function dictionarySeeds(word: string, tags: string[]): Promise<Seed[]> {
  const defs = await define(word);
  if (defs.length === 0) return [];
  return [
    {
      form: normalize(word),
      gloss: defs[0]?.definition ?? word,
      language: 'english',
      source: 'dictionary',
      tags,
      weight: 0.6,
      note: defs.map((d) => `(${d.partOfSpeech}) ${d.definition}`).join(' · '),
    },
  ];
}
