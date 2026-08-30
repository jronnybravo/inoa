/**
 * Stage 3 material: concepts, not synonyms.
 *
 * The best names almost never come from a thesaurus run on the category word.
 * They come from another field entirely — a keystone, a halcyon, a lodestar —
 * that happens to carry the brand's idea. This is that library.
 */

import type { ConceptDomain } from '../core/types.ts';

export interface Concept {
  term: string;
  domain: ConceptDomain;
  meaning: string;
  tags: string[];
  /** 0..1 — how well the word itself would wear as a brand. */
  beauty: number;
}

const C = (
  term: string,
  domain: ConceptDomain,
  meaning: string,
  tags: string,
  beauty: number,
): Concept => ({ term, domain, meaning, tags: tags.split(' '), beauty });

export const CONCEPTS: Concept[] = [
  // Mythology
  C('halcyon', 'mythology', 'a bird that calmed the winter sea; a time of peace', 'calm memory trust rest', 0.94),
  C('atlas', 'mythology', 'the titan who carries the sky; a book of maps', 'strength structure knowledge', 0.88),
  C('orpheus', 'mythology', 'the musician who could move stone', 'sound persuasion craft', 0.72),
  C('iris', 'mythology', 'messenger goddess of the rainbow; part of the eye', 'connection vision color', 0.9),
  C('hermes', 'mythology', 'god of messages, roads and commerce', 'speed exchange connection', 0.7),
  C('vesta', 'mythology', 'goddess of the hearth fire', 'home warmth care', 0.86),
  C('juno', 'mythology', 'protector goddess; also a moon probe', 'protection authority', 0.84),
  C('freya', 'mythology', 'Norse goddess of love and abundance', 'warmth abundance', 0.82),
  C('bragi', 'mythology', 'Norse god of poetry and eloquence', 'expression craft', 0.7),
  C('yggdra', 'mythology', 'the world tree connecting all realms', 'connection structure scale', 0.76),
  C('phoenix', 'mythology', 'the bird that renews itself from fire', 'renewal resilience', 0.8),
  C('argo', 'mythology', 'the ship of the first great voyage', 'journey discovery courage', 0.88),
  C('kairos', 'mythology', 'the opportune moment', 'timing judgment insight', 0.86),
  C('mnemos', 'mythology', 'memory personified, mother of the muses', 'memory origin', 0.74),
  C('elysian', 'mythology', 'the blessed fields; perfect ease', 'calm premium reward', 0.8),

  // Astronomy
  C('vega', 'astronomy', 'one of the brightest stars in the northern sky', 'guidance ambition light', 0.9),
  C('lyra', 'astronomy', 'the harp constellation containing Vega', 'sound grace premium', 0.9),
  C('polaris', 'astronomy', 'the pole star; the one that does not move', 'guidance constancy trust', 0.88),
  C('lodestar', 'astronomy', 'the star you steer by', 'guidance purpose trust', 0.86),
  C('orion', 'astronomy', 'the hunter constellation', 'ambition scale recognition', 0.84),
  C('aurora', 'astronomy', 'polar light; dawn', 'light wonder origin', 0.92),
  C('corona', 'astronomy', 'the sun\'s outer atmosphere', 'light scale energy', 0.6),
  C('perihelion', 'astronomy', 'the closest approach to the sun', 'proximity peak precision', 0.7),
  C('albedo', 'astronomy', 'how much light a surface returns', 'light reflection measurement', 0.76),
  C('parallax', 'astronomy', 'apparent shift that reveals true distance', 'perspective insight precision', 0.84),
  C('zenith', 'astronomy', 'the point directly overhead', 'ambition peak', 0.86),
  C('nadir', 'astronomy', 'the point directly below', 'depth origin', 0.66),
  C('sidereal', 'astronomy', 'measured by the stars', 'time precision wonder', 0.78),
  C('penumbra', 'astronomy', 'the partial shadow at an eclipse edge', 'nuance depth', 0.76),
  C('apogee', 'astronomy', 'the farthest point of an orbit', 'ambition scale', 0.74),

  // Geography & weather
  C('meridian', 'geography', 'the line of noon; a peak of activity', 'precision navigation ambition', 0.9),
  C('isthmus', 'geography', 'a narrow bridge of land between seas', 'connection passage', 0.7),
  C('delta', 'geography', 'where a river fans into the sea; rate of change', 'flow change growth', 0.82),
  C('estuary', 'geography', 'where fresh and salt water mix', 'flow connection abundance', 0.74),
  C('confluence', 'geography', 'where two rivers join', 'connection convergence flow', 0.82),
  C('summit', 'geography', 'the highest reachable point', 'ambition achievement', 0.78),
  C('cove', 'geography', 'a sheltered inlet', 'calm safety home', 0.86),
  C('fjord', 'geography', 'a deep sea inlet cut by ice', 'depth calm nature', 0.8),
  C('atoll', 'geography', 'a ring of coral around a lagoon', 'protection wholeness nature', 0.8),
  C('savanna', 'geography', 'open grassland', 'space freedom nature', 0.76),
  C('tundra', 'geography', 'treeless northern plain', 'endurance space', 0.7),
  C('alluvial', 'geography', 'soil enriched by moving water', 'growth abundance flow', 0.78),
  C('watershed', 'geography', 'the divide that decides where water goes', 'decision scale origin', 0.76),
  C('monsoon', 'weather', 'the season-turning wind and rain', 'change abundance power', 0.74),
  C('zephyr', 'weather', 'the gentle west wind', 'calm lightness motion', 0.88),
  C('mistral', 'weather', 'a strong cold wind of southern France', 'power motion clarity', 0.6),
  C('cirrus', 'weather', 'the highest, wispiest cloud', 'lightness altitude calm', 0.82),
  C('solstice', 'weather', 'the turning point of the year', 'time turning ritual', 0.84),
  C('equinox', 'weather', 'the day balanced between light and dark', 'balance time harmony', 0.84),

  // Biology
  C('mycelium', 'biology', 'the underground network that feeds a forest', 'network connection growth', 0.82),
  C('symbiosis', 'biology', 'two organisms that thrive together', 'connection mutual growth', 0.7),
  C('canopy', 'biology', 'the living roof of a forest', 'protection scale nature', 0.84),
  C('lichen', 'biology', 'an alliance that survives bare rock', 'resilience partnership', 0.7),
  C('cambium', 'biology', 'the thin living layer where a tree grows', 'growth origin craft', 0.76),
  C('kestrel', 'biology', 'a falcon that hovers perfectly still to hunt', 'precision focus grace', 0.86),
  C('heron', 'biology', 'a patient, precise hunter of shallows', 'patience precision calm', 0.82),
  C('sable', 'biology', 'a marten prized for its coat; deep black', 'premium depth', 0.84),
  C('lumen', 'biology', 'the open channel inside a vessel; a unit of light', 'light flow clarity', 0.9),
  C('vireo', 'biology', 'a small green songbird', 'sound nature lightness', 0.78),
  C('coral', 'biology', 'an animal that builds a city out of stone', 'growth structure community', 0.8),
  C('pollen', 'biology', 'the courier of plant reproduction', 'spread growth connection', 0.7),
  C('nectar', 'biology', 'the reward that powers pollination', 'reward sweetness exchange', 0.8),
  C('plumage', 'biology', 'the signalling surface of a bird', 'expression beauty', 0.72),
  C('helix', 'biology', 'the spiral of inheritance', 'structure growth science', 0.86),

  // Architecture & materials
  C('keystone', 'architecture', 'the stone that locks an arch together', 'structure trust essential', 0.88),
  C('lintel', 'architecture', 'the beam that holds an opening', 'structure support', 0.7),
  C('atrium', 'architecture', 'the open, light-filled center of a building', 'space light welcome', 0.84),
  C('portico', 'architecture', 'a covered welcome at an entrance', 'welcome craft', 0.76),
  C('vault', 'architecture', 'a curved roof; a secure room', 'protection structure', 0.82),
  C('spire', 'architecture', 'the highest reach of a building', 'ambition precision', 0.84),
  C('trellis', 'architecture', 'a frame that lets growth climb', 'support growth structure', 0.82),
  C('mosaic', 'architecture', 'a whole assembled from many pieces', 'composition community craft', 0.8),
  C('tessera', 'architecture', 'a single tile in a mosaic', 'unit craft composition', 0.84),
  C('cairn', 'architecture', 'a stack of stones marking the way', 'guidance memory craft', 0.86),
  C('bastion', 'architecture', 'a projecting stronghold', 'protection strength', 0.76),
  C('alcove', 'architecture', 'a recess made for one purpose', 'focus calm home', 0.8),
  C('lattice', 'architecture', 'a crossing structure that is strong and open', 'structure network clarity', 0.82),
  C('obsidian', 'materials', 'volcanic glass, sharp and black', 'precision premium depth', 0.86),
  C('basalt', 'materials', 'the dense rock the ocean floor is made of', 'strength foundation', 0.78),
  C('quartz', 'materials', 'the crystal that keeps time', 'precision clarity', 0.8),
  C('amber', 'materials', 'resin that preserves what it holds', 'memory warmth preservation', 0.88),
  C('slate', 'materials', 'stone that splits clean; a fresh start', 'clarity craft origin', 0.82),
  C('bronze', 'materials', 'the alloy that started an age', 'craft strength origin', 0.76),
  C('graphite', 'materials', 'soft carbon that draws and lubricates', 'craft precision', 0.72),
  C('lumina', 'materials', 'light-bearing surface', 'light premium', 0.86),

  // Engineering & mathematics
  C('fulcrum', 'engineering', 'the point that makes leverage possible', 'leverage precision essential', 0.86),
  C('flywheel', 'engineering', 'stored motion that keeps a system turning', 'momentum compounding', 0.76),
  C('gimbal', 'engineering', 'a mount that stays level through any motion', 'stability precision', 0.82),
  C('torque', 'engineering', 'rotational force', 'power precision', 0.74),
  C('ballast', 'engineering', 'weight that keeps a vessel upright', 'stability trust', 0.78),
  C('cascade', 'engineering', 'stages that pass energy forward', 'flow sequence', 0.8),
  C('conduit', 'engineering', 'a protected channel for what must pass', 'flow protection connection', 0.76),
  C('aperture', 'engineering', 'the opening that decides how much light enters', 'vision control precision', 0.84),
  C('vernier', 'engineering', 'the scale that reads between the marks', 'precision refinement', 0.78),
  C('escapement', 'engineering', 'the mechanism that turns force into exact time', 'precision time craft', 0.7),
  C('tessellate', 'mathematics', 'to tile a plane with no gaps', 'composition order scale', 0.72),
  C('vector', 'mathematics', 'magnitude with direction', 'direction precision', 0.8),
  C('modulus', 'mathematics', 'the measure of what remains; a stiffness constant', 'precision structure', 0.72),
  C('axiom', 'mathematics', 'what is accepted so that everything else can be proved', 'foundation truth clarity', 0.86),
  C('lemma', 'mathematics', 'a small proved step toward a bigger truth', 'proof craft', 0.76),
  C('sigma', 'mathematics', 'the sum of everything', 'totality precision', 0.78),
  C('quanta', 'mathematics', 'the smallest indivisible amounts', 'precision unit science', 0.8),
  C('asymptote', 'mathematics', 'the line you approach forever', 'ambition limit', 0.66),
  C('manifold', 'mathematics', 'a space that is simple everywhere you stand', 'scale structure', 0.76),

  // Music & craft
  C('cadence', 'music', 'the rhythm of arrival', 'rhythm flow resolution', 0.84),
  C('tempo', 'music', 'the speed a thing is meant to move at', 'rhythm speed control', 0.8),
  C('octave', 'music', 'the interval where a note returns as itself', 'harmony return structure', 0.82),
  C('overtone', 'music', 'the hidden frequencies that give a note its character', 'depth nuance identity', 0.78),
  C('resonance', 'music', 'when one thing makes another vibrate', 'connection emotion amplification', 0.8),
  C('crescendo', 'music', 'a controlled build', 'growth energy', 0.74),
  C('rondo', 'music', 'a form built on a returning theme', 'return rhythm', 0.78),
  C('vellum', 'craft', 'the prepared surface that outlasts paper', 'craft memory premium', 0.82),
  C('patina', 'craft', 'the finish only time can apply', 'time authenticity premium', 0.84),
  C('joinery', 'craft', 'holding wood together without fasteners', 'craft connection precision', 0.76),
  C('kintsugi', 'craft', 'repairing a break with gold so it shows', 'repair honesty beauty', 0.8),
  C('selvage', 'craft', 'the woven edge that stops a cloth unravelling', 'craft protection quality', 0.76),

  // Navigation & sport
  C('fathom', 'navigation', 'a measure of depth; to fully understand', 'depth insight measurement', 0.9),
  C('bearing', 'navigation', 'the direction you are actually travelling', 'direction clarity', 0.76),
  C('astrolabe', 'navigation', 'the instrument that found your place by the stars', 'guidance craft precision', 0.78),
  C('sextant', 'navigation', 'measures the angle to a star to fix a position', 'precision guidance', 0.8),
  C('ballard', 'navigation', 'the post a ship is made fast to', 'stability safety', 0.68),
  C('leeward', 'navigation', 'the sheltered side', 'shelter calm', 0.74),
  C('regatta', 'sports', 'a race of many boats', 'competition community motion', 0.76),
  C('peloton', 'sports', 'the pack that moves faster together', 'community efficiency motion', 0.6),
  C('cadre', 'sports', 'a trained core group', 'team craft', 0.72),
  C('pivot', 'sports', 'the planted foot that lets you change direction', 'agility stability change', 0.78),
  C('relay', 'sports', 'the handoff that keeps momentum', 'continuity teamwork', 0.78),

  // Psychology & philosophy
  C('flow', 'psychology', 'total absorption in a task', 'focus ease joy', 0.8),
  C('salience', 'psychology', 'what the mind cannot help noticing', 'attention clarity', 0.74),
  C('valence', 'psychology', 'the pull of an emotion, positive or negative', 'emotion measurement', 0.78),
  C('gestalt', 'psychology', 'the whole the parts cannot explain', 'wholeness insight', 0.72),
  C('anchoring', 'psychology', 'the first number that shapes every judgment after it', 'stability influence', 0.66),
  C('ataraxia', 'philosophy', 'freedom from disturbance', 'calm rest clarity', 0.72),
  C('eudaimonia', 'philosophy', 'flourishing, the good life lived well', 'growth wellbeing purpose', 0.66),
  C('praxis', 'philosophy', 'theory made into practice', 'craft action', 0.78),
  C('telos', 'philosophy', 'the end a thing is for', 'purpose direction', 0.82),
  C('arete', 'philosophy', 'excellence as the fulfilment of purpose', 'quality craft ambition', 0.84),
  C('sonder', 'philosophy', 'the realization that every stranger has a full life', 'empathy connection', 0.82),
  C('ikigai', 'philosophy', 'the reason you get up in the morning', 'purpose warmth', 0.74),
  C('logos', 'philosophy', 'reason, and the word that carries it', 'truth intelligence order', 0.76),
  C('numen', 'philosophy', 'the presence felt in a place', 'wonder depth', 0.78),
];

/** Every tag in the bank, for brief matching. */
export const CONCEPT_TAGS: string[] = [
  ...new Set(CONCEPTS.flatMap((c) => c.tags)),
].sort();
