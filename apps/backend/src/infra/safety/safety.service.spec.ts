import { SafetyService } from './safety.service';
import { SAFETY_CATEGORIES, SafetyCategory } from './safety.rules';

const safety = new SafetyService();
const cats = (text: string) => safety.evaluateText(text).categories;

describe('SafetyService.evaluateText: English', () => {
  const cases: Array<[string, SafetyCategory]> = [
    ['There is a gas leak near the stove', 'GAS'],
    ['I smell gas in the kitchen', 'GAS'],
    ['it smells like gas when the heater starts', 'GAS'],
    ['the oven is leaking gas', 'GAS'],
    ['I can smell a burning smell from the fridge', 'BURNING'],
    ['something is burnt inside the dryer', 'BURNING'],
    ['the washing machine caught fire', 'BURNING'],
    ['the AC is on fire!', 'BURNING'],
    ['smoke is coming out of the AC unit', 'SMOKE'],
    ['the microwave is smoking', 'SMOKE'],
    ['smoky smell from the vent', 'SMOKE'],
    ['I saw sparks from the plug', 'SPARKS'],
    ['the outlet is sparking', 'SPARKS'],
    ['there was a short circuit in the dishwasher', 'SPARKS'],
    ['I got an electric shock touching the fridge', 'ELECTRIC_SHOCK'],
    ['the washer gave me a shock', 'ELECTRIC_SHOCK'],
    ['my kid was electrocuted by the heater', 'ELECTRIC_SHOCK'],
    ['I get a tingling feeling when I touch it', 'ELECTRIC_SHOCK'],
    ['water is leaking onto the electrical outlet', 'WATER_NEAR_OUTLET'],
    ['the socket is wet after the pipe burst', 'WATER_NEAR_OUTLET'],
    ['water dripping near the wiring of the AC', 'WATER_NEAR_OUTLET'],
  ];
  it.each(cases)('%s -> %s', (text, category) => {
    expect(cats(text)).toContain(category);
  });

  it('is case-insensitive and tolerant of punctuation', () => {
    expect(cats('GAS LEAK!!!')).toContain('GAS');
    expect(cats('Smoke... everywhere')).toContain('SMOKE');
  });

  it('returns several categories in a fixed order', () => {
    expect(cats('smoke and sparks and a gas leak')).toEqual(['GAS', 'SMOKE', 'SPARKS']);
  });
});

describe('SafetyService.evaluateText: Arabic', () => {
  const cases: Array<[string, SafetyCategory]> = [
    ['في تسريب غاز في المطبخ', 'GAS'],
    ['ريحة غاز من الفرن', 'GAS'],
    ['رائحة الغاز قوية', 'GAS'],
    ['في ريحة حرق من الغسالة', 'BURNING'],
    ['الجهاز يحترق', 'BURNING'],
    ['صار في حريق بالمكيف', 'BURNING'],
    ['طلعت نار من الفرن', 'BURNING'],
    ['دخان طالع من المكيف', 'SMOKE'],
    ['الميكروويف بيدخن', 'SMOKE'],
    ['شرارة طلعت من الفيشة', 'SPARKS'],
    ['صار ماس كهربائي', 'SPARKS'],
    ['الغسالة بتشرر', 'SPARKS'],
    ['صعقني التيار من الثلاجة', 'ELECTRIC_SHOCK'],
    ['ضربتني الكهربا لما لمست الغسالة', 'ELECTRIC_SHOCK'],
    ['تعرضت لصعقة كهربائية', 'ELECTRIC_SHOCK'],
    ['في ماء قرب المقبس', 'WATER_NEAR_OUTLET'],
    ['المي واصلة عالبرايز', 'WATER_NEAR_OUTLET'],
    ['تسريب مياه قرب الاسلاك الكهربائية', 'WATER_NEAR_OUTLET'],
  ];
  it.each(cases)('%s -> %s', (text, category) => {
    expect(cats(text)).toContain(category);
  });

  it('normalizes hamza, diacritics and teh marbuta', () => {
    expect(cats('رَائِحَةُ غَازٍ')).toContain('GAS');
    expect(cats('تسرّب الماء قرب المأخذ')).toContain('WATER_NEAR_OUTLET');
  });
});

describe('SafetyService.evaluateText: Arabizi', () => {
  const cases: Array<[string, SafetyCategory]> = [
    ['fi re7et gaz bel matbakh', 'GAS'],
    ['ri7et ghaz men el forn', 'GAS'],
    ['fi 7ari2 bel mkayyef', 'BURNING'],
    ['el jehez ma7rouk', 'BURNING'],
    ['tal3et nar men el ghassele', 'BURNING'],
    ['fi dokhan men el AC', 'SMOKE'],
    ['el microwave bydokhen', 'SMOKE'],
    ['fi shrara men el prize', 'SPARKS'],
    ['el ghassele byshrer', 'SPARKS'],
    ['darabatni el kahraba', 'ELECTRIC_SHOCK'],
    ['el kahraba sa3a2atni', 'ELECTRIC_SHOCK'],
    ['el mayy 3al prize', 'WATER_NEAR_OUTLET'],
    ['fi maye 3al socket', 'WATER_NEAR_OUTLET'],
  ];
  it.each(cases)('%s -> %s', (text, category) => {
    expect(cats(text)).toContain(category);
  });
});

describe('SafetyService.evaluateText: no hit', () => {
  it.each([
    'The fridge is not cooling',
    'AC makes a loud noise when it starts',
    'the washing machine does not drain',
    'dishwasher leaves white spots on glasses',
    'the dryer takes too long to dry clothes',
    'I may have to replace the plug later',
    'الثلاجة ما عم تبرد',
    'الغسالة بتعمل صوت عالي',
    'el ghassele ma 3am te3sir',
    '',
  ])('%j', (text) => {
    expect(safety.evaluateText(text)).toEqual({ hit: false, categories: [] });
  });

  it('handles null and undefined', () => {
    expect(safety.evaluateText(null).hit).toBe(false);
    expect(safety.evaluateText(undefined).hit).toBe(false);
  });
});

describe('SafetyService.evaluateText: known false positives still hit (a hit only asks a question)', () => {
  it.each([
    ['smoke detector battery is low', 'SMOKE'],
    ['the AC needs a gas leak test before refilling', 'GAS'],
    ['I burned the toast and now the toaster smells', 'BURNING'],
    ['شحن غاز المكيف', 'GAS'],
  ])('%s', (text, category) => {
    const result = safety.evaluateText(text);
    expect(result.hit).toBe(true);
    expect(result.categories).toContain(category);
  });
});

describe('SafetyService.evaluateIntake', () => {
  it.each([
    [{ safety_concern: true }, true],
    [{ safety_concern: true, other: 'x' }, true],
    [{ safety_concern: false }, false],
    [{ safety_concern: 'yes' }, false], // only the boolean true counts
    [{ safety_concern: 1 }, false],
    [{ safety_concern: 'true' }, false],
    [{ safety: true }, false], // the old guessed keys are gone
    [{ safety_answer: 'yes' }, false],
    [{ is_safety_concern: true }, false],
    [{ has_safety_concern: true }, false],
    [{ other: 'yes' }, false],
    [{}, false],
    [null, false],
    [undefined, false],
    ['yes', false],
    [[{ safety_concern: true }], false],
  ])('%j -> hit %s', (answers, hit) => {
    expect(safety.evaluateIntake(answers).hit).toBe(hit);
  });
});

describe('SafetyService.confirmationQuestion', () => {
  it('has fixed text for every category in English and Arabic', () => {
    for (const category of SAFETY_CATEGORIES) {
      const en = safety.confirmationQuestion(category, 'en');
      const ar = safety.confirmationQuestion(category, 'ar');
      expect(en).toMatch(/\?$/);
      expect(ar).toMatch(/؟$/);
      expect(en).not.toEqual(ar);
    }
  });

  it('defaults to English and uses Arabic for dialect codes', () => {
    expect(safety.confirmationQuestion('GAS')).toBe('Can you smell gas right now?');
    expect(safety.confirmationQuestion('GAS', 'ar-LB')).toBe('هل تشم رائحة غاز الآن؟');
  });

  it('keeps Arabizi speakers on the Latin-script question', () => {
    expect(safety.confirmationQuestion('GAS', 'ar-latn')).toBe('Can you smell gas right now?');
  });
});
