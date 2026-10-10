import { validateSchedule } from './schedule.validation';

const problemsOf = (input: unknown): string[] => {
  try {
    validateSchedule(input);
  } catch (err) {
    return (err as { details?: string[] }).details ?? [(err as Error).message];
  }
  return [];
};

describe('validateSchedule', () => {
  it('accepts a valid week and returns it with windows sorted', () => {
    const result = validateSchedule({
      mon: [{ from: '13:00', to: '17:00' }, { from: '08:00', to: '12:00' }],
      sat: [],
      sun: [{ from: '00:00', to: '23:59' }],
    });
    expect(result).toEqual({
      mon: [{ from: '08:00', to: '12:00' }, { from: '13:00', to: '17:00' }],
      sat: [],
      sun: [{ from: '00:00', to: '23:59' }],
    });
  });

  it('treats null as "clear the schedule"', () => {
    expect(validateSchedule(null)).toBeNull();
  });

  it('accepts windows that touch (12:00 to 12:00)', () => {
    expect(validateSchedule({ tue: [{ from: '08:00', to: '12:00' }, { from: '12:00', to: '16:00' }] })).not.toBeNull();
  });

  it.each([
    ['a string', 'mon'],
    ['an array', [{ from: '08:00', to: '17:00' }]],
    ['a number', 5],
    ['undefined', undefined],
  ])('rejects %s with a 422', (_name, input) => {
    expect(() => validateSchedule(input)).toThrow(expect.objectContaining({ code: 'INVALID_SCHEDULE', status: 422 }));
  });

  it('rejects an empty object (use null to clear)', () => {
    expect(problemsOf({})[0]).toMatch(/empty/);
  });

  it('rejects unknown day keys, including wrong case', () => {
    expect(problemsOf({ monday: [] })[0]).toMatch(/not a day/);
    expect(problemsOf({ MON: [] })[0]).toMatch(/not a day/);
  });

  it('rejects a day that is not a list', () => {
    expect(problemsOf({ mon: { from: '08:00', to: '17:00' } })[0]).toMatch(/list/);
    expect(problemsOf({ mon: null })[0]).toMatch(/list/);
  });

  it.each(['8:00', '24:00', '12:60', '0800', '', 'noon', '08:00:00'])('rejects the time %p', (time) => {
    expect(problemsOf({ mon: [{ from: time, to: '23:00' }] })[0]).toMatch(/from must be a time/);
    expect(problemsOf({ mon: [{ from: '01:00', to: time }] })[0]).toMatch(/to must be a time/);
  });

  it('rejects a non-string time', () => {
    expect(problemsOf({ mon: [{ from: 800, to: '17:00' }] })[0]).toMatch(/from must be a time/);
  });

  it('rejects "from" equal to or after "to"', () => {
    expect(problemsOf({ mon: [{ from: '17:00', to: '08:00' }] })[0]).toMatch(/must be before/);
    expect(problemsOf({ mon: [{ from: '08:00', to: '08:00' }] })[0]).toMatch(/must be before/);
  });

  it('rejects overlapping windows and too many windows', () => {
    expect(problemsOf({ mon: [{ from: '08:00', to: '12:00' }, { from: '11:00', to: '15:00' }] })[0]).toMatch(/overlap/);
    const five = [0, 1, 2, 3, 4].map((i) => ({ from: `0${i}:00`, to: `0${i}:30` }));
    expect(problemsOf({ mon: five })[0]).toMatch(/at most 4/);
  });

  it('rejects extra fields inside a window and non-object windows', () => {
    expect(problemsOf({ mon: [{ from: '08:00', to: '17:00', note: 'x' }] })[0]).toMatch(/unknown field/);
    expect(problemsOf({ mon: ['08:00-17:00'] })[0]).toMatch(/expected \{ from, to \}/);
  });

  it('reports every problem at once', () => {
    const problems = problemsOf({ funday: [], mon: [{ from: '25:00', to: '17:00' }], tue: 'x' });
    expect(problems).toHaveLength(3);
  });
});
