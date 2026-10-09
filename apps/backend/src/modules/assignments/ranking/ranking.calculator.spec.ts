import { MaintenanceCategory as Cat, RequestPriority as P } from '@prisma/client';
import { TechnicianInput, WEIGHTS, exclusionReasons, rankTechnicians } from './ranking.calculator';

function tech(id: string, over: Partial<TechnicianInput> = {}): TechnicianInput {
  return {
    technicianProfileId: id,
    userId: `user-${id}`,
    name: `Tech ${id}`,
    accountActive: true,
    isAvailable: true,
    isPaymentBlocked: false,
    yearsOfExperience: 5,
    rating: 4,
    totalReviews: 10,
    normalRate: 20,
    emergencyRate: 20,
    skills: [{ category: Cat.HVAC, proficiency: 4 }],
    hasActiveJob: false,
    ...over,
  };
}

const request = (priority: P, category: Cat = Cat.HVAC) => ({ priority, category });

describe('ranking weights', () => {
  it('match the plan and each set adds up to 100%', () => {
    expect(WEIGHTS.normal).toEqual({ skill: 0.3, availability: 0.3, experience: 0.15, feedback: 0.15, rate: 0.1 });
    expect(WEIGHTS.emergency).toEqual({ skill: 0.3, availability: 0.4, experience: 0.15, feedback: 0.1, rate: 0.05 });
    for (const set of [WEIGHTS.normal, WEIGHTS.emergency]) {
      expect(Object.values(set).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });
});

describe('exclusionReasons', () => {
  it('is empty for an eligible technician', () => {
    expect(exclusionReasons(tech('a'), Cat.HVAC)).toEqual([]);
  });

  it('lists every reason that applies', () => {
    const bad = tech('a', { accountActive: false, isAvailable: false, isPaymentBlocked: true });
    expect(exclusionReasons(bad, Cat.HOME_APPLIANCES)).toEqual([
      'ACCOUNT_INACTIVE',
      'NOT_AVAILABLE',
      'PAYMENT_BLOCKED',
      'MISSING_SKILL',
    ]);
  });

  it('requires a skill in the case category, not just any skill', () => {
    const appliance = tech('a', { skills: [{ category: Cat.HOME_APPLIANCES, proficiency: 5 }] });
    expect(exclusionReasons(appliance, Cat.HVAC)).toEqual(['MISSING_SKILL']);
  });
});

describe('rankTechnicians (worked examples)', () => {
  // A: skill 4/5=.8, free=1, 5y=.5, rating 4/5=.8, cheapest=1   B: skill 1, busy=0, 10y=1, rating 1, dearest=0
  const a = tech('a', { normalRate: 20, emergencyRate: 20 });
  const b = tech('b', {
    skills: [{ category: Cat.HVAC, proficiency: 5 }],
    hasActiveJob: true,
    yearsOfExperience: 10,
    rating: 5,
    normalRate: 30,
    emergencyRate: 30,
  });

  it('scores a NORMAL request with the normal weights', () => {
    const result = rankTechnicians(request(P.NORMAL), [b, a]);
    // A = .3*.8 + .3*1 + .15*.5 + .15*.8 + .1*1 = .835     B = .3*1 + 0 + .15*1 + .15*1 + 0 = .6
    expect(result.ranking.map((r) => [r.technicianProfileId, r.rank, r.score])).toEqual([
      ['a', 1, 83.5],
      ['b', 2, 60],
    ]);
    expect(result.rateType).toBe('NORMAL');
    expect(result.ranking[0].factors).toEqual({ skill: 0.8, availability: 1, experience: 0.5, feedback: 0.8, rate: 1 });
    expect(result.ranking[0].contributions).toEqual({ skill: 24, availability: 30, experience: 7.5, feedback: 12, rate: 10 });
  });

  it('scores an EMERGENCY request with the emergency weights and the emergency rate', () => {
    const result = rankTechnicians(request(P.EMERGENCY), [a, b]);
    // A = .3*.8 + .4*1 + .15*.5 + .1*.8 + .05*1 = .845     B = .3*1 + 0 + .15 + .1 + 0 = .55
    expect(result.ranking.map((r) => [r.technicianProfileId, r.score])).toEqual([
      ['a', 84.5],
      ['b', 55],
    ]);
    expect(result.rateType).toBe('EMERGENCY');
    expect(result.weights).toEqual(WEIGHTS.emergency);
  });

  it('treats URGENT like NORMAL', () => {
    expect(rankTechnicians(request(P.URGENT), [a, b]).weights).toEqual(WEIGHTS.normal);
    expect(rankTechnicians(request(P.URGENT), [a, b]).rateType).toBe('NORMAL');
  });

  it('uses the emergency rate for emergencies and the normal rate otherwise', () => {
    const cheapNormalDearEmergency = tech('c', { normalRate: 10, emergencyRate: 90 });
    const other = tech('d', { normalRate: 50, emergencyRate: 40 });
    const normal = rankTechnicians(request(P.NORMAL), [cheapNormalDearEmergency, other]);
    const emergency = rankTechnicians(request(P.EMERGENCY), [cheapNormalDearEmergency, other]);
    expect(normal.ranking.find((r) => r.technicianProfileId === 'c')!.factors.rate).toBe(1);
    expect(emergency.ranking.find((r) => r.technicianProfileId === 'c')!.factors.rate).toBe(0);
    expect(emergency.ranking.find((r) => r.technicianProfileId === 'c')!.rateUsed).toBe(90);
  });
});

describe('rankTechnicians (edge cases)', () => {
  it('gives everyone a rate factor of 1 when all rates are equal', () => {
    const result = rankTechnicians(request(P.NORMAL), [tech('a'), tech('b')]);
    expect(result.ranking.every((r) => r.factors.rate === 1)).toBe(true);
  });

  it('works with a single candidate', () => {
    const result = rankTechnicians(request(P.NORMAL), [tech('a')]);
    expect(result.ranking).toHaveLength(1);
    expect(result.ranking[0].rank).toBe(1);
  });

  it('gives an unreviewed technician a neutral feedback score, not zero', () => {
    const result = rankTechnicians(request(P.NORMAL), [tech('a', { rating: 0, totalReviews: 0 })]);
    expect(result.ranking[0].factors.feedback).toBe(0.5);
  });

  it('caps experience at 10 years and proficiency at 5', () => {
    const result = rankTechnicians(request(P.NORMAL), [
      tech('a', { yearsOfExperience: 40, skills: [{ category: Cat.HVAC, proficiency: 9 }] }),
    ]);
    expect(result.ranking[0].factors.experience).toBe(1);
    expect(result.ranking[0].factors.skill).toBe(1);
  });

  it('uses the best proficiency among the skills of the case category', () => {
    const result = rankTechnicians(request(P.NORMAL), [
      tech('a', {
        skills: [
          { category: Cat.HVAC, proficiency: 2 },
          { category: Cat.HVAC, proficiency: 4 },
          { category: Cat.HOME_APPLIANCES, proficiency: 5 },
        ],
      }),
    ]);
    expect(result.ranking[0].factors.skill).toBe(0.8);
  });

  it('scores availability 0 for a technician with an active job, even though they stay eligible', () => {
    const result = rankTechnicians(request(P.NORMAL), [tech('a', { hasActiveJob: true })]);
    expect(result.ranking[0].factors.availability).toBe(0);
    expect(result.ranking).toHaveLength(1);
  });

  it('reports excluded technicians with their reasons and returns an empty ranking when nobody is eligible', () => {
    const result = rankTechnicians(request(P.NORMAL), [tech('a', { isAvailable: false }), tech('b', { isPaymentBlocked: true })]);
    expect(result.ranking).toEqual([]);
    expect(result.excluded).toEqual([
      { technicianProfileId: 'a', name: 'Tech a', reasons: ['NOT_AVAILABLE'] },
      { technicianProfileId: 'b', name: 'Tech b', reasons: ['PAYMENT_BLOCKED'] },
    ]);
  });

  it('breaks ties by experience, then lower rate, then id, and is deterministic', () => {
    // Both score exactly the same except experience is traded against rate; build a true tie first.
    const x = tech('x');
    const y = tech('y');
    const first = rankTechnicians(request(P.NORMAL), [y, x]);
    const second = rankTechnicians(request(P.NORMAL), [x, y]);
    expect(first.ranking.map((r) => r.technicianProfileId)).toEqual(['x', 'y']);
    expect(second.ranking.map((r) => r.technicianProfileId)).toEqual(['x', 'y']);
    expect(first.ranking[0].score).toBe(first.ranking[1].score);

    const veteran = tech('v', { yearsOfExperience: 10, rating: 0, totalReviews: 10 });
    const fresh = tech('f', { yearsOfExperience: 0, rating: 5, totalReviews: 10 });
    // veteran: .15*1 + 0 = .15 from these two factors; fresh: 0 + .15*1 = .15 -> equal scores, veteran has more experience
    const tied = rankTechnicians(request(P.NORMAL), [fresh, veteran]);
    expect(tied.ranking[0].score).toBe(tied.ranking[1].score);
    expect(tied.ranking[0].technicianProfileId).toBe('v');
  });

  it('does not change its input', () => {
    const input = [tech('a'), tech('b', { normalRate: 40 })];
    const copy = JSON.parse(JSON.stringify(input));
    rankTechnicians(request(P.NORMAL), input);
    expect(input).toEqual(copy);
  });
});
