/**
 * Keyword rules for the safety check (English, Arabic, Arabizi).
 *
 * A keyword hit never escalates a request by itself. It only means "ask the fixed confirmation question";
 * only a clear Yes escalates. The lists are therefore deliberately broad (false positives such as
 * "smoke detector battery is low" are expected and cost one extra question).
 *
 * Patterns run on text that went through `normalize()`: lower-cased, Arabic diacritics and tatweel removed,
 * alef/yeh/teh-marbuta variants folded (أ إ آ -> ا, ى -> ي, ة -> ه).
 */

export type SafetyCategory =
  | 'GAS'
  | 'BURNING'
  | 'SMOKE'
  | 'SPARKS'
  | 'ELECTRIC_SHOCK'
  | 'WATER_NEAR_OUTLET';

export const SAFETY_CATEGORIES: readonly SafetyCategory[] = [
  'GAS',
  'BURNING',
  'SMOKE',
  'SPARKS',
  'ELECTRIC_SHOCK',
  'WATER_NEAR_OUTLET',
];

export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel, dagger alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

const B_START = '(?<![\\p{L}\\p{N}])';
const B_END = '(?![\\p{L}\\p{N}])';
/** Whole-word match (works for Arabic, where \b does not). */
const word = (source: string): string => `${B_START}(?:${source})${B_END}`;
/** Common Arabic one-letter and article prefixes (the, and, with, for ...). */
const AR_PREFIX = '(?:وال|بال|لل|عال|ال|و|ب|ل|ك|ف|ع)?';
const build = (sources: string[]): RegExp[] => sources.map((s) => new RegExp(s, 'iu'));

// "near" helpers: two groups of words within a short span of the same sentence, either order.
const near = (a: string, b: string, span = 50): string[] => [
  `${word(a)}[^.!?؟\\n]{0,${span}}${word(b)}`,
  `${word(b)}[^.!?؟\\n]{0,${span}}${word(a)}`,
];

const EN_WATER = 'water|wet|leak(?:s|ing|ed)?|flood(?:s|ed|ing)?|drip(?:s|ping)?|puddle|splash(?:ed|ing)?';
const EN_ELECTRIC = 'outlets?|sockets?|plugs?|wiring|wires?|electric(?:al|ity)?|breaker|fuse box|panel|power strip|extension cord|cable';

const AR_WATER = `${AR_PREFIX}(?:ماء|مي|ميه|مياه|تسرب|تسريب|بلل|مبلول|مبلوله|غرق|غرقان|رطوبه|ينقط|تنقيط)`;
const AR_ELECTRIC = `${AR_PREFIX}(?:مقبس|مقابس|ماخذ|مآخذ|فيشه|فيش|بريزه|برايز|سلك|اسلاك|كهربا[ءه]?|كهربائي(?:ه)?|لوحه كهربا[ءه]?|قاطع|تيار|سوكيت|كيبل|كابل)`;

const ARZ_WATER = 'mai|maye|mayy|mayye|mayet|miye|moyeh|maya|mayy?e|netef|ynatet|bynattet|bte2ter|mablool|mabloul|mblool|tasarob|tasarrob|tasrib';
const ARZ_ELECTRIC = 'prize|prise|prese|briz|brize|fiche|fish|socket|sokit|sou?kit|ka7rab\\w*|kahrab\\w*|ke7rbe|kahrbe|slek|sle?k|aslak|breaker|brekker|tableau|panel|lo7it';

export const SAFETY_RULES: Record<SafetyCategory, RegExp[]> = {
  GAS: build([
    // English
    word('gas\\s+(?:leak\\w*|smell\\w*|odou?r|fumes?)'),
    word('(?:smell|smells|smelling|smelt|odou?r)\\s+(?:of\\s+|like\\s+)?(?:a\\s+)?gas'),
    word('leak(?:s|ing)?\\s+gas'),
    word('gas\\s+(?:is\\s+)?leak\\w*'),
    // Arabic: any "gas" word (leak, smell, stove) opens the confirmation question
    word(`${AR_PREFIX}غاز(?:ات)?`),
    // Arabizi
    word('gaz|ghaz|8az'),
    word('(?:re7a|ri7a|re7et|ri7et|rayha|ra2e7a|rihet|rihat)\\s*(?:el\\s*|il\\s*)?(?:gas|gaz|ghaz)'),
  ]),
  BURNING: build([
    // English
    word('burn(?:ing|t|s|ed)?'),
    word('on fire|caught fire|catch(?:ing)? fire|fire'),
    // Arabic
    word(`${AR_PREFIX}(?:حريق|احتراق|يحترق|تحترق|بتحترق|احترق|محروق|محروقه|حرق|حارق|يحرق|بتحرق|شياط)`),
    word(`${AR_PREFIX}نار(?:ه|ا)?`),
    // Arabizi (7 = ح, 2 = ء/ق, 5 = خ)
    word('7ari2|7arik|7ar2|7arie2|hari2|hariq|hareeq|7areeq|7ra2|7rak|ma7rou2a?|ma7rouk|bet7ere2|bye7tere2|byo7tare2|bye7tare2'),
    word('nar|na2r|shayyat|shiyat|shayat'),
  ]),
  SMOKE: build([
    word('smok(?:e|es|ing|ed|y)'),
    word(`${AR_PREFIX}(?:دخان|يدخن|بيدخن|تدخن|بتدخن|دخن)`),
    word('dokhan|dokkhan|dokhkhan|dukhan|dokan|da5an|do5an|d5an|dou5an|bydokhen|bydo5en|byedakhen|bidakhen|bedakhen|bidakhin|byde5en'),
  ]),
  SPARKS: build([
    word('spark(?:s|ed|ing|y)?|arcing'),
    word('short[\\s-]?circuit(?:ed|ing)?'),
    word(`${AR_PREFIX}(?:شرار(?:ه|ات)?|شرر|يشرر|بيشرر|تشرر|بتشرر|سبارك)`),
    word('(?:ماس|تماس|ماس) كهربا[ءه]?(?:ي|ئي)?(?:ه)?'),
    word('shrara|sharara|sharar|chrara|shrar|shrer|byshrer|bishrer|byshrir'),
    word('(?:mas|tamas) kahraba(?:2i|\'i|i)?'),
  ]),
  ELECTRIC_SHOCK: build([
    word('(?:electric(?:al)?|static)\\s+shock\\w*'),
    word('electrocut\\w*'),
    word('(?:got|get|getting|gave|gives|give|giving)\\s+(?:me\\s+|him\\s+|her\\s+|us\\s+|a\\s+|an\\s+){0,3}shock\\w*'),
    word('shocked(?:\\s+me)?|shock(?:s)?\\s+me|tingl(?:e|es|ing|y)'),
    word(`${AR_PREFIX}(?:صعق\\p{L}*|صعقه|كهربني|كهربتني|كهربنا|يكهرب|بيكهرب|بتكهرب)`),
    word(`(?:ضربتني|ضربني|ضربت|مسكتني|مسكني|لسعتني|لسعني)\\s+${AR_PREFIX}(?:كهربا[ءه]?|تيار)`),
    word(`${AR_PREFIX}(?:كهربا[ءه]?|تيار)\\s+(?:ضربتني|ضربني|صعقتني|صعقني|مسكتني|مسكني|لسعتني|لسعني)`),
    word('(?:darab(?:et|ni|atni)?|darabni|darabatni)\\s+(?:el\\s*|il\\s*)?(?:kahrab\\w*|ka7rab\\w*|kahrbe|ke7rbe)'),
    word('(?:el\\s*|il\\s*)?(?:kahrab\\w*|ka7rab\\w*|kahrbe|ke7rbe)\\s+(?:darabatni|darabni|sa3a2atni|sa3a2ni|masaketni|masakni)'),
    word('kahrabatni|kahrabni|ka7rabatni|sa3a2ni|sa3a2atni|sa3a2et|sa3a2'),
  ]),
  WATER_NEAR_OUTLET: build([
    ...near(EN_WATER, EN_ELECTRIC),
    ...near(AR_WATER, AR_ELECTRIC, 40),
    ...near(ARZ_WATER, ARZ_ELECTRIC, 40),
  ]),
};

/** Fixed backend text asked when a keyword appears. Never generated by AI. */
export const CONFIRMATION_QUESTIONS: Record<SafetyCategory, { en: string; ar: string }> = {
  GAS: {
    en: 'Can you smell gas right now?',
    ar: 'هل تشم رائحة غاز الآن؟',
  },
  BURNING: {
    en: 'Is there a burning smell or a fire right now?',
    ar: 'هل هناك رائحة حرق أو نار الآن؟',
  },
  SMOKE: {
    en: 'Is there smoke coming from the appliance right now?',
    ar: 'هل يخرج دخان من الجهاز الآن؟',
  },
  SPARKS: {
    en: 'Do you see sparks coming from the appliance or an outlet?',
    ar: 'هل ترى شرارًا يخرج من الجهاز أو من المقبس؟',
  },
  ELECTRIC_SHOCK: {
    en: 'Did you or anyone else get an electric shock from the appliance?',
    ar: 'هل تعرّض أحد لصعقة كهربائية من الجهاز؟',
  },
  WATER_NEAR_OUTLET: {
    en: 'Is there water near an electrical outlet or wiring right now?',
    ar: 'هل يوجد ماء قرب مقبس كهرباء أو أسلاك الآن؟',
  },
};
