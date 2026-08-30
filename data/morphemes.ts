/**
 * Combining forms — the raw stock for compounds, portmanteaus and invented words.
 *
 * Every entry earns its place by being beautiful in isolation. Roots that are
 * meaningful but ugly in Latin script ('sphygmo-', 'psycho-') are excluded on
 * purpose: a root nobody can pronounce cannot become a brand.
 */

import type { Language } from '../core/types.ts';

export interface Morpheme {
  form: string;
  language: Language;
  gloss: string;
  tags: string[];
  role: 'prefix' | 'suffix' | 'free';
  /** 0..1 — how well it survives contact with a logo and a phone call. */
  beauty: number;
}

const M = (
  form: string,
  language: Language,
  gloss: string,
  tags: string,
  role: Morpheme['role'],
  beauty: number,
): Morpheme => ({ form, language, gloss, tags: tags.split(' '), role, beauty });

export const MORPHEMES: Morpheme[] = [
  // Light, vision, clarity
  M('lum', 'latin', 'light', 'light clarity vision insight', 'prefix', 0.92),
  M('luc', 'latin', 'light, lucid', 'light clarity truth', 'prefix', 0.88),
  M('lux', 'latin', 'light', 'light premium clarity', 'free', 0.9),
  M('clar', 'latin', 'clear', 'clarity truth simplicity', 'prefix', 0.82),
  M('phos', 'greek', 'light', 'light energy', 'prefix', 0.7),
  M('aur', 'latin', 'dawn, gold', 'light warmth premium origin', 'prefix', 0.93),
  M('sol', 'latin', 'sun', 'light energy warmth', 'free', 0.9),
  M('helio', 'greek', 'sun', 'light energy scale', 'prefix', 0.78),
  M('vis', 'latin', 'to see', 'vision insight clarity', 'prefix', 0.8),
  M('opt', 'greek', 'sight, best', 'vision precision quality', 'prefix', 0.72),
  M('scop', 'greek', 'to look at', 'vision discovery', 'suffix', 0.7),
  M('phan', 'greek', 'to appear, show', 'vision revelation', 'prefix', 0.68),
  M('ray', 'english', 'beam of light', 'light speed energy', 'free', 0.85),
  M('glow', 'english', 'steady light', 'light warmth care', 'free', 0.84),
  M('spark', 'english', 'ignition', 'energy origin creativity', 'free', 0.8),
  M('dawn', 'english', 'first light', 'origin hope calm', 'free', 0.83),
  M('hikari', 'japanese', 'light', 'light clarity calm', 'free', 0.74),
  M('nur', 'arabic', 'light', 'light warmth trust', 'free', 0.86),
  M('zohar', 'hebrew', 'radiance', 'light insight', 'free', 0.7),
  M('jyoti', 'sanskrit', 'light, flame', 'light insight warmth', 'free', 0.72),

  // Speed, motion, flow
  M('vel', 'latin', 'swift', 'speed motion precision', 'prefix', 0.86),
  M('celer', 'latin', 'swift', 'speed energy', 'prefix', 0.74),
  M('cur', 'latin', 'to run, course', 'motion journey flow', 'prefix', 0.72),
  M('flu', 'latin', 'to flow', 'flow ease continuity', 'prefix', 0.78),
  M('rive', 'french', 'bank, shore', 'flow journey calm', 'free', 0.76),
  M('tach', 'greek', 'speed', 'speed precision', 'prefix', 0.68),
  M('drom', 'greek', 'running, course', 'speed journey', 'suffix', 0.7),
  M('kinet', 'greek', 'motion', 'motion energy', 'prefix', 0.66),
  M('flux', 'latin', 'continuous change', 'flow change energy', 'free', 0.82),
  M('vent', 'latin', 'wind', 'motion freedom energy', 'prefix', 0.8),
  M('aero', 'greek', 'air', 'motion freedom lightness', 'prefix', 0.8),
  M('volo', 'latin', 'to fly, to will', 'freedom motion intent', 'free', 0.84),
  M('swift', 'english', 'fast, a bird', 'speed grace', 'free', 0.8),
  M('drift', 'english', 'to move with a current', 'flow calm freedom', 'free', 0.76),
  M('glide', 'english', 'to move smoothly', 'flow ease grace', 'free', 0.82),
  M('surge', 'english', 'sudden rise', 'energy growth power', 'free', 0.78),
  M('hayai', 'japanese', 'fast', 'speed', 'free', 0.6),
  M('presto', 'italian', 'quickly', 'speed music energy', 'free', 0.82),
  M('vento', 'italian', 'wind', 'motion freedom', 'free', 0.84),
  M('rapid', 'latin', 'swift', 'speed', 'free', 0.7),

  // Trust, protection, care
  M('fid', 'latin', 'faith, trust', 'trust safety loyalty', 'prefix', 0.82),
  M('cred', 'latin', 'to believe', 'trust finance', 'prefix', 0.74),
  M('cert', 'latin', 'sure, settled', 'trust precision proof', 'prefix', 0.72),
  M('firm', 'latin', 'steady, strong', 'trust strength stability', 'free', 0.76),
  M('salv', 'latin', 'safe, well', 'safety health care', 'prefix', 0.74),
  M('tut', 'latin', 'to guard', 'safety care guidance', 'prefix', 0.7),
  M('aegis', 'greek', 'shield of Athena', 'protection trust authority', 'free', 0.88),
  M('vera', 'latin', 'true', 'truth trust clarity', 'free', 0.9),
  M('ver', 'latin', 'true, spring', 'truth origin growth', 'prefix', 0.84),
  M('anchor', 'english', 'holds a ship steady', 'stability trust calm', 'free', 0.78),
  M('haven', 'english', 'place of safety', 'safety calm home', 'free', 0.86),
  M('keep', 'english', 'a stronghold; to hold', 'protection memory home', 'free', 0.74),
  M('ward', 'english', 'to guard', 'protection care', 'suffix', 0.76),
  M('amn', 'arabic', 'safety, security', 'safety trust', 'prefix', 0.7),
  M('emet', 'hebrew', 'truth', 'truth trust', 'free', 0.68),
  M('mamori', 'japanese', 'protection, to guard', 'protection care', 'free', 0.66),
  M('vardh', 'sanskrit', 'to grow, prosper', 'growth care', 'prefix', 0.62),

  // Mind, knowledge, intelligence
  M('cogn', 'latin', 'to know', 'intelligence insight', 'prefix', 0.7),
  M('sap', 'latin', 'to taste, to be wise', 'intelligence judgment', 'prefix', 0.68),
  M('mens', 'latin', 'mind', 'intelligence focus', 'free', 0.72),
  M('noe', 'greek', 'mind, intellect', 'intelligence insight', 'prefix', 0.74),
  M('soph', 'greek', 'wisdom', 'intelligence judgment premium', 'prefix', 0.82),
  M('gnos', 'greek', 'knowledge', 'intelligence insight', 'prefix', 0.7),
  M('mnem', 'greek', 'memory', 'memory intelligence', 'prefix', 0.72),
  M('logos', 'greek', 'word, reason', 'intelligence order truth', 'free', 0.76),
  M('vid', 'sanskrit', 'to know', 'intelligence insight', 'prefix', 0.78),
  M('budh', 'sanskrit', 'to awaken, understand', 'insight awakening', 'prefix', 0.66),
  M('savoir', 'french', 'to know', 'intelligence craft', 'free', 0.72),
  M('mind', 'english', 'the thinking self', 'intelligence care attention', 'free', 0.74),

  // Order, structure, craft
  M('ord', 'latin', 'order, rank', 'order structure clarity', 'prefix', 0.74),
  M('struct', 'latin', 'to build', 'structure engineering', 'prefix', 0.68),
  M('tect', 'greek', 'builder, craft', 'craft structure', 'suffix', 0.72),
  M('arc', 'latin', 'arch, chief', 'structure origin authority', 'prefix', 0.86),
  M('atrium', 'latin', 'open central hall', 'space calm architecture', 'free', 0.8),
  M('portico', 'italian', 'covered entrance', 'architecture welcome', 'free', 0.76),
  M('mesa', 'spanish', 'table, flat height', 'stability ground clarity', 'free', 0.8),
  M('forge', 'english', 'to make by heat and force', 'craft strength origin', 'free', 0.84),
  M('loom', 'english', 'frame that weaves', 'craft connection structure', 'free', 0.8),
  M('lathe', 'english', 'a shaping machine', 'craft precision', 'free', 0.74),
  M('kiln', 'english', 'oven that hardens', 'craft transformation', 'free', 0.72),
  M('atelier', 'french', 'artist workshop', 'craft premium', 'free', 0.78),
  M('takumi', 'japanese', 'artisan, master craftsman', 'craft precision premium', 'free', 0.76),
  M('shokunin', 'japanese', 'craftsperson', 'craft devotion', 'free', 0.6),

  // Connection, community, exchange
  M('nex', 'latin', 'to bind, connect', 'connection network', 'prefix', 0.84),
  M('junct', 'latin', 'to join', 'connection network', 'prefix', 0.66),
  M('soci', 'latin', 'companion', 'connection community', 'prefix', 0.7),
  M('syn', 'greek', 'together with', 'connection harmony', 'prefix', 0.8),
  M('koin', 'greek', 'common, shared', 'community sharing', 'prefix', 0.7),
  M('agora', 'greek', 'public gathering place', 'community exchange market', 'free', 0.86),
  M('forum', 'latin', 'public square', 'community exchange', 'free', 0.72),
  M('bridge', 'english', 'crossing between', 'connection trust journey', 'free', 0.78),
  M('weave', 'english', 'to interlace', 'connection craft flow', 'free', 0.82),
  M('kin', 'english', 'family, related', 'community warmth home', 'free', 0.84),
  M('mesh', 'english', 'interlocking network', 'connection network', 'free', 0.72),
  M('plaza', 'spanish', 'public square', 'community exchange', 'free', 0.78),
  M('sangam', 'sanskrit', 'confluence, meeting of rivers', 'connection flow community', 'free', 0.7),
  M('wa', 'japanese', 'harmony, circle', 'harmony community calm', 'suffix', 0.72),

  // Growth, nature, origin
  M('gen', 'greek', 'birth, origin', 'origin growth creation', 'suffix', 0.8),
  M('nov', 'latin', 'new', 'origin novelty', 'prefix', 0.82),
  M('orig', 'latin', 'beginning, source', 'origin authenticity', 'prefix', 0.68),
  M('prim', 'latin', 'first', 'origin premium priority', 'prefix', 0.78),
  M('sem', 'latin', 'seed', 'origin growth potential', 'prefix', 0.74),
  M('flor', 'latin', 'flower, to flourish', 'growth beauty health', 'prefix', 0.86),
  M('viv', 'latin', 'alive', 'life energy health', 'prefix', 0.84),
  M('vita', 'latin', 'life', 'life health energy', 'free', 0.88),
  M('bio', 'greek', 'life', 'life health science', 'prefix', 0.74),
  M('phyt', 'greek', 'plant', 'growth nature', 'suffix', 0.62),
  M('arbor', 'latin', 'tree', 'growth nature stability', 'free', 0.84),
  M('grove', 'english', 'small wood', 'nature calm community', 'free', 0.86),
  M('root', 'english', 'origin, anchor', 'origin stability nature', 'free', 0.78),
  M('bloom', 'english', 'to flower', 'growth beauty optimism', 'free', 0.86),
  M('harvest', 'english', 'gathering of yield', 'growth abundance', 'free', 0.72),
  M('terra', 'latin', 'earth', 'nature ground scale', 'free', 0.88),
  M('sylva', 'latin', 'forest', 'nature calm depth', 'free', 0.86),
  M('mori', 'japanese', 'forest', 'nature calm', 'free', 0.78),
  M('ankur', 'sanskrit', 'sprout', 'growth origin', 'free', 0.64),

  // Space, scale, ambition
  M('astr', 'greek', 'star', 'ambition space wonder', 'prefix', 0.86),
  M('stell', 'latin', 'star', 'ambition space premium', 'prefix', 0.88),
  M('cosm', 'greek', 'ordered universe', 'scale order wonder', 'prefix', 0.82),
  M('orb', 'latin', 'circle, sphere', 'scale wholeness', 'free', 0.82),
  M('polar', 'greek', 'of the pole', 'direction guidance', 'free', 0.78),
  M('vast', 'english', 'immense', 'scale ambition', 'free', 0.74),
  M('summit', 'english', 'highest point', 'ambition achievement', 'free', 0.76),
  M('apex', 'latin', 'peak', 'ambition premium precision', 'free', 0.84),
  M('zenith', 'arabic', 'highest point in the sky', 'ambition premium', 'free', 0.86),
  M('meridian', 'latin', 'noon line, high point', 'ambition navigation precision', 'free', 0.84),
  M('sora', 'japanese', 'sky', 'scale calm freedom', 'free', 0.86),
  M('himmel', 'german', 'sky, heaven', 'scale wonder', 'free', 0.66),
  M('akash', 'sanskrit', 'sky, space', 'scale calm', 'free', 0.74),

  // Calm, warmth, home
  M('quies', 'latin', 'rest, quiet', 'calm rest', 'prefix', 0.72),
  M('seren', 'latin', 'clear, untroubled', 'calm clarity trust', 'prefix', 0.88),
  M('paz', 'spanish', 'peace', 'calm trust', 'free', 0.8),
  M('calma', 'italian', 'calm', 'calm care', 'free', 0.82),
  M('hearth', 'english', 'the fire at the center of a home', 'home warmth care', 'free', 0.82),
  M('nest', 'english', 'a made home', 'home care safety', 'free', 0.78),
  M('cove', 'english', 'sheltered inlet', 'calm safety nature', 'free', 0.84),
  M('casa', 'spanish', 'house', 'home warmth', 'free', 0.8),
  M('foyer', 'french', 'hearth, entrance hall', 'home warmth welcome', 'free', 0.76),
  M('heim', 'german', 'home', 'home belonging', 'suffix', 0.72),
  M('ie', 'japanese', 'house, household', 'home family', 'free', 0.6),
  M('shanti', 'sanskrit', 'peace', 'calm rest', 'free', 0.78),
  M('salam', 'arabic', 'peace', 'calm trust', 'free', 0.8),
  M('shalom', 'hebrew', 'peace, wholeness', 'calm trust wholeness', 'free', 0.72),

  // Strength, endurance, resolve
  M('fort', 'latin', 'strong', 'strength endurance', 'prefix', 0.78),
  M('valid', 'latin', 'strong, effective', 'strength proof', 'prefix', 0.66),
  M('robur', 'latin', 'oak, strength', 'strength endurance', 'free', 0.74),
  M('dyn', 'greek', 'power', 'energy strength', 'prefix', 0.74),
  M('erg', 'greek', 'work', 'energy craft', 'suffix', 0.66),
  M('titan', 'greek', 'elder giant', 'strength scale', 'free', 0.72),
  M('stal', 'old-norse', 'steel, standing', 'strength endurance', 'prefix', 0.7),
  M('bjorn', 'old-norse', 'bear', 'strength protection', 'free', 0.74),
  M('vald', 'old-norse', 'power, rule', 'strength authority', 'suffix', 0.7),
  M('sten', 'old-norse', 'stone', 'strength endurance', 'suffix', 0.74),
  M('forge', 'english', 'to shape by force', 'strength craft', 'free', 0.84),
  M('keel', 'english', 'the spine of a ship', 'stability endurance', 'free', 0.78),

  // Navigation, guidance, discovery
  M('nav', 'latin', 'ship', 'navigation journey', 'prefix', 0.76),
  M('port', 'latin', 'harbor, to carry', 'journey safety exchange', 'free', 0.78),
  M('via', 'latin', 'road, way', 'journey method clarity', 'free', 0.86),
  M('iter', 'latin', 'journey', 'journey progress', 'prefix', 0.7),
  M('helm', 'english', 'the wheel of a ship', 'guidance control', 'free', 0.82),
  M('compass', 'english', 'direction instrument', 'guidance precision', 'free', 0.72),
  M('beacon', 'english', 'a guiding light', 'guidance light trust', 'free', 0.82),
  M('north', 'english', 'the fixed direction', 'guidance clarity', 'free', 0.78),
  M('quest', 'english', 'a search with purpose', 'discovery journey', 'free', 0.76),
  M('camino', 'spanish', 'road, way', 'journey progress', 'free', 0.8),
  M('sendero', 'spanish', 'path', 'journey discovery', 'free', 0.72),
  M('michi', 'japanese', 'path, the way', 'journey discipline', 'free', 0.74),
  M('vega', 'arabic', 'the falling star (Lyra)', 'guidance ambition', 'free', 0.86),

  // Sound, rhythm, expression
  M('son', 'latin', 'sound', 'sound expression', 'prefix', 0.8),
  M('ton', 'greek', 'tone, tension', 'sound precision', 'suffix', 0.74),
  M('phon', 'greek', 'voice, sound', 'sound expression', 'suffix', 0.7),
  M('canto', 'italian', 'song', 'sound expression warmth', 'free', 0.82),
  M('aria', 'italian', 'air, solo melody', 'sound grace lightness', 'free', 0.9),
  M('cadence', 'english', 'rhythmic fall', 'rhythm flow craft', 'free', 0.8),
  M('chord', 'english', 'notes struck together', 'harmony connection', 'free', 0.76),
  M('echo', 'greek', 'returning sound', 'sound memory', 'free', 0.8),
  M('lyra', 'greek', 'the lyre, a constellation', 'sound grace premium', 'free', 0.88),
  M('rondo', 'italian', 'a recurring musical form', 'rhythm return', 'free', 0.78),

  // Measure, precision, proof
  M('metr', 'greek', 'measure', 'precision measurement', 'suffix', 0.74),
  M('calc', 'latin', 'pebble, to reckon', 'precision math', 'prefix', 0.62),
  M('norm', 'latin', 'carpenter square, rule', 'precision standard', 'prefix', 0.7),
  M('axi', 'greek', 'axis, worth', 'precision structure', 'prefix', 0.76),
  M('vector', 'latin', 'carrier, direction', 'direction precision', 'free', 0.8),
  M('prism', 'greek', 'splits light into parts', 'clarity analysis precision', 'free', 0.86),
  M('caliber', 'english', 'measured bore; quality', 'precision quality', 'free', 0.76),
  M('plumb', 'english', 'true vertical', 'precision truth', 'free', 0.72),
  M('true', 'english', 'accurate, faithful', 'truth precision trust', 'free', 0.8),
];

/** Endings that read as brand-like without becoming a cliché. */
export const BRAND_SUFFIXES: { form: string; feel: string; weight: number }[] = [
  { form: 'a', feel: 'open, warm, human', weight: 1 },
  { form: 'o', feel: 'round, confident, Latinate', weight: 0.95 },
  { form: 'os', feel: 'Greek, systemic, serious', weight: 0.7 },
  { form: 'ia', feel: 'place-like, expansive', weight: 0.85 },
  { form: 'io', feel: 'modern, technical, light', weight: 0.8 },
  { form: 'ora', feel: 'luminous, feminine, premium', weight: 0.9 },
  { form: 'ari', feel: 'airy, Italianate', weight: 0.7 },
  { form: 'is', feel: 'classical, compact', weight: 0.75 },
  { form: 'ix', feel: 'sharp, technical, decisive', weight: 0.7 },
  { form: 'yx', feel: 'rare, mineral, cryptic', weight: 0.6 },
  { form: 'um', feel: 'elemental, scientific', weight: 0.7 },
  { form: 'us', feel: 'Latin, institutional', weight: 0.6 },
  { form: 'en', feel: 'Nordic, plain, calm', weight: 0.8 },
  { form: 'on', feel: 'solid, particle-like', weight: 0.85 },
  { form: 'an', feel: 'grounded, human', weight: 0.8 },
  { form: 'ay', feel: 'open, spoken, friendly', weight: 0.75 },
  { form: 'era', feel: 'epochal, sweeping', weight: 0.8 },
  { form: 'ura', feel: 'soft, natural', weight: 0.8 },
  { form: 'ana', feel: 'lyrical, collective', weight: 0.75 },
  { form: 'ael', feel: 'mythic, elevated', weight: 0.65 },
];

/** Openers that colour a name without stacking adjectives. */
export const BRAND_PREFIXES: { form: string; feel: string; weight: number }[] = [
  { form: 'a', feel: 'toward, open vowel start', weight: 0.8 },
  { form: 'ad', feel: 'toward, additive', weight: 0.7 },
  { form: 'co', feel: 'together', weight: 0.75 },
  { form: 'en', feel: 'to put into', weight: 0.7 },
  { form: 'in', feel: 'inward, inherent', weight: 0.7 },
  { form: 'pro', feel: 'forward, professional', weight: 0.65 },
  { form: 're', feel: 'again, restoration', weight: 0.7 },
  { form: 'se', feel: 'apart, considered', weight: 0.6 },
  { form: 'tra', feel: 'across', weight: 0.7 },
  { form: 'ver', feel: 'true', weight: 0.8 },
  { form: 'sol', feel: 'sun, whole', weight: 0.85 },
  { form: 'novi', feel: 'new', weight: 0.8 },
];
