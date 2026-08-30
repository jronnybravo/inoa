/**
 * Curated multilingual lexicon (Stage 2).
 *
 * Machine translation is the wrong tool here: it returns the *correct* word,
 * not the *beautiful* one, and it has no opinion about whether an English
 * speaker can say it. Every entry below was chosen because it is pronounceable
 * on first sight in Latin script, carries no unfortunate second meaning, and
 * would look right on a building.
 */

import type { Language } from '../core/types.ts';

export interface LexEntry {
  form: string;
  native?: string;
  language: Language;
  gloss: string;
  tags: string[];
  /** 0..1 — brandability of the word as-is. */
  beauty: number;
}

const L = (
  form: string,
  language: Language,
  gloss: string,
  tags: string,
  beauty: number,
  native?: string,
): LexEntry => ({ form, language, gloss, tags: tags.split(' '), beauty, native });

export const LEXICON: LexEntry[] = [
  // Light & clarity
  L('lumen', 'latin', 'light', 'light clarity vision', 0.9),
  L('lucerna', 'latin', 'lamp', 'light guidance home', 0.82),
  L('clarté', 'french', 'clarity, brightness', 'clarity light', 0.78),
  L('lueur', 'french', 'a faint glow', 'light calm', 0.72),
  L('luce', 'italian', 'light', 'light clarity', 0.86),
  L('chiaro', 'italian', 'clear, bright', 'clarity light', 0.78),
  L('claro', 'spanish', 'clear, bright', 'clarity light', 0.76),
  L('brillo', 'spanish', 'shine', 'light energy', 0.72),
  L('licht', 'german', 'light', 'light clarity', 0.62),
  L('hikari', 'japanese', 'light', 'light clarity calm', 0.76, '光'),
  L('akari', 'japanese', 'a lamp, a gentle light', 'light home warmth', 0.86, '明かり'),
  L('bit', 'korean', 'light', 'light clarity', 0.6, '빛'),
  L('nur', 'arabic', 'light', 'light warmth trust', 0.86, 'نور'),
  L('ziv', 'hebrew', 'radiance', 'light energy', 0.7, 'זיו'),
  L('deepa', 'sanskrit', 'lamp', 'light guidance ritual', 0.8, 'दीप'),
  L('prakash', 'sanskrit', 'light, illumination', 'light insight', 0.72, 'प्रकाश'),
  L('dagr', 'old-norse', 'day', 'light origin', 0.74),

  // Calm, peace, rest
  L('quies', 'latin', 'rest, stillness', 'calm rest', 0.72),
  L('serena', 'latin', 'clear and untroubled', 'calm trust', 0.9),
  L('calme', 'french', 'calm', 'calm care', 0.76),
  L('douceur', 'french', 'gentleness, softness', 'care warmth calm', 0.74),
  L('sereno', 'italian', 'serene, clear-skied', 'calm clarity', 0.86),
  L('quieto', 'spanish', 'still', 'calm rest', 0.7),
  L('remanso', 'spanish', 'a still pool in a moving river', 'calm rest flow', 0.82),
  L('ruhe', 'german', 'rest, quiet', 'calm rest', 0.62),
  L('nagi', 'japanese', 'the calm after wind', 'calm rest', 0.8, '凪'),
  L('shizuka', 'japanese', 'quiet, tranquil', 'calm focus', 0.72, '静か'),
  L('goyo', 'korean', 'stillness', 'calm rest', 0.66, '고요'),
  L('salam', 'arabic', 'peace', 'calm trust', 0.82, 'سلام'),
  L('shalva', 'hebrew', 'tranquility', 'calm rest', 0.74, 'שלווה'),
  L('shanti', 'sanskrit', 'peace', 'calm rest', 0.8, 'शान्ति'),
  L('friðr', 'old-norse', 'peace, safety', 'calm safety', 0.66),

  // Trust, truth, honour
  L('veritas', 'latin', 'truth', 'truth trust proof', 0.84),
  L('fides', 'latin', 'faith, trust', 'trust loyalty', 0.8),
  L('fiducia', 'italian', 'trust, confidence', 'trust warmth', 0.78),
  L('confianza', 'spanish', 'trust', 'trust', 0.62),
  L('vrai', 'french', 'true', 'truth', 0.66),
  L('treue', 'german', 'loyalty, fidelity', 'trust loyalty', 0.6),
  L('makoto', 'japanese', 'sincerity, truth', 'truth trust craft', 0.82, '誠'),
  L('amana', 'arabic', 'trust held in safekeeping', 'trust protection', 0.84, 'أمانة'),
  L('emuna', 'hebrew', 'faith, steadfastness', 'trust endurance', 0.72, 'אמונה'),
  L('satya', 'sanskrit', 'truth', 'truth clarity', 0.78, 'सत्य'),
  L('trú', 'old-norse', 'belief, trust', 'trust', 0.68),

  // Motion, speed, journey
  L('celeris', 'latin', 'swift', 'speed', 0.74),
  L('vento', 'italian', 'wind', 'motion freedom', 0.86),
  L('volare', 'italian', 'to fly', 'freedom motion joy', 0.82),
  L('viento', 'spanish', 'wind', 'motion freedom', 0.78),
  L('camino', 'spanish', 'the road, the way', 'journey progress', 0.82),
  L('vuelo', 'spanish', 'flight', 'freedom motion', 0.74),
  L('élan', 'french', 'momentum, spirited dash', 'energy motion grace', 0.86),
  L('essor', 'french', 'taking flight, rapid growth', 'growth motion', 0.78),
  L('flug', 'german', 'flight', 'motion freedom', 0.6),
  L('tsubasa', 'japanese', 'wings', 'freedom motion', 0.78, '翼'),
  L('kaze', 'japanese', 'wind', 'motion freedom calm', 0.8, '風'),
  L('baram', 'korean', 'wind', 'motion freedom', 0.66, '바람'),
  L('gati', 'sanskrit', 'motion, path, momentum', 'motion journey', 0.74, 'गति'),
  L('vega', 'old-norse', 'way, road (vegr)', 'journey guidance', 0.84),
  L('fara', 'old-norse', 'to travel', 'journey', 0.72),

  // Growth, life, nature
  L('vita', 'latin', 'life', 'life health energy', 0.9),
  L('vivere', 'latin', 'to live', 'life energy', 0.78),
  L('semilla', 'spanish', 'seed', 'origin growth', 0.78),
  L('raíz', 'spanish', 'root', 'origin stability', 0.7),
  L('rinascita', 'italian', 'rebirth', 'renewal growth', 0.72),
  L('verdure', 'french', 'greenery', 'growth nature calm', 0.76),
  L('printemps', 'french', 'spring', 'origin growth', 0.6),
  L('midori', 'japanese', 'green, verdure', 'growth nature calm', 0.84, '緑'),
  L('sakura', 'japanese', 'cherry blossom', 'beauty transience warmth', 0.86, '桜'),
  L('mori', 'japanese', 'forest', 'nature calm depth', 0.8, '森'),
  L('namu', 'korean', 'tree', 'growth nature', 0.66, '나무'),
  L('bija', 'sanskrit', 'seed, origin', 'origin growth', 0.76, 'बीज'),
  L('ankura', 'sanskrit', 'sprout', 'growth origin', 0.7, 'अंकुर'),
  L('askr', 'old-norse', 'ash tree, the world tree', 'growth structure origin', 0.76),

  // Home, warmth, care
  L('domus', 'latin', 'home', 'home belonging', 0.74),
  L('focus', 'latin', 'the hearth, in its original sense', 'home warmth attention', 0.6),
  L('casa', 'italian', 'house, home', 'home warmth', 0.82),
  L('cura', 'latin', 'care, attention', 'care craft trust', 0.86),
  L('abrigo', 'spanish', 'shelter, coat', 'protection warmth', 0.78),
  L('hogar', 'spanish', 'home, hearth', 'home warmth', 0.74),
  L('foyer', 'french', 'hearth, entrance hall', 'home warmth welcome', 0.78),
  L('nid', 'french', 'nest', 'home care', 0.62),
  L('heim', 'german', 'home', 'home belonging', 0.72),
  L('geborgen', 'german', 'safe and held', 'safety warmth', 0.55),
  L('ie', 'japanese', 'house, household', 'home family', 0.6, '家'),
  L('nukumori', 'japanese', 'lingering warmth', 'warmth care', 0.72, '温もり'),
  L('jip', 'korean', 'house', 'home', 0.58, '집'),
  L('dar', 'arabic', 'house, dwelling', 'home belonging', 0.72, 'دار'),
  L('bayit', 'hebrew', 'house, home', 'home family', 0.68, 'בית'),
  L('griha', 'sanskrit', 'home', 'home family', 0.66, 'गृह'),

  // Strength, craft, mastery
  L('fortis', 'latin', 'strong, brave', 'strength courage', 0.78),
  L('opus', 'latin', 'a work, a made thing', 'craft achievement', 0.84),
  L('forza', 'italian', 'strength, force', 'strength energy', 0.8),
  L('maestria', 'italian', 'mastery', 'craft quality', 0.8),
  L('taller', 'spanish', 'workshop', 'craft', 0.66),
  L('métier', 'french', 'craft, trade, calling', 'craft purpose', 0.8),
  L('atelier', 'french', 'a maker\'s studio', 'craft premium', 0.8),
  L('kraft', 'german', 'force, power', 'strength energy', 0.72),
  L('takumi', 'japanese', 'master artisan', 'craft precision premium', 0.78, '匠'),
  L('kata', 'japanese', 'the practised form', 'craft discipline', 0.74, '型'),
  L('sona', 'korean', 'skilled hand (son = hand)', 'craft care', 0.7),
  L('itqan', 'arabic', 'mastery, doing a thing perfectly', 'craft quality', 0.74, 'إتقان'),
  L('shakti', 'sanskrit', 'power, energy', 'strength energy', 0.78, 'शक्ति'),
  L('smiðr', 'old-norse', 'smith, maker', 'craft origin', 0.7),

  // Connection & community
  L('nexus', 'latin', 'the binding together', 'connection network', 0.82),
  L('unio', 'latin', 'oneness, a single pearl', 'connection wholeness premium', 0.8),
  L('insieme', 'italian', 'together', 'community warmth', 0.7),
  L('juntos', 'spanish', 'together', 'community warmth', 0.72),
  L('ensemble', 'french', 'together; a group that performs as one', 'community harmony craft', 0.78),
  L('en', 'japanese', 'the bond or affinity between people', 'connection fate warmth', 0.7, '縁'),
  L('kizuna', 'japanese', 'the tie that binds people', 'connection loyalty warmth', 0.78, '絆'),
  L('jeong', 'korean', 'deep attachment built over time', 'connection warmth loyalty', 0.7, '정'),
  L('sangam', 'sanskrit', 'confluence, coming together', 'connection flow', 0.74, 'संगम'),
  L('ubuntu', 'english', 'I am because we are (Nguni Bantu)', 'community empathy', 0.7),
  L('yachad', 'hebrew', 'together', 'community', 0.66, 'יחד'),

  // Wonder, discovery, ambition
  L('mirari', 'latin', 'to wonder at', 'wonder discovery', 0.8),
  L('altus', 'latin', 'high, deep', 'ambition depth', 0.82),
  L('scoperta', 'italian', 'discovery', 'discovery', 0.72),
  L('hallazgo', 'spanish', 'a find, a discovery', 'discovery', 0.62),
  L('trouvaille', 'french', 'a lucky find', 'discovery delight', 0.74),
  L('sehnsucht', 'german', 'longing for something distant', 'ambition emotion', 0.6),
  L('yume', 'japanese', 'dream', 'ambition wonder', 0.8, '夢'),
  L('sora', 'japanese', 'sky', 'scale freedom calm', 0.86, '空'),
  L('haneul', 'korean', 'sky', 'scale freedom', 0.66, '하늘'),
  L('amal', 'arabic', 'hope', 'hope warmth', 0.8, 'أمل'),
  L('tikva', 'hebrew', 'hope', 'hope', 0.7, 'תקווה'),
  L('asha', 'sanskrit', 'hope, aspiration', 'hope ambition', 0.82, 'आशा'),
  L('leiðr', 'old-norse', 'a way found, a course', 'guidance discovery', 0.66),
];

export const LEXICON_LANGUAGES: Language[] = [
  ...new Set(LEXICON.map((e) => e.language)),
];
