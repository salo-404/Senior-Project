import { AppException } from '../../common/app.exception';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];
export interface TimeWindow {
  from: string;
  to: string;
}
export type WeeklySchedule = Partial<Record<Day, TimeWindow[]>>;

export const MAX_WINDOWS_PER_DAY = 4;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates technician_profiles.weekly_schedule: { mon: [{ from: "08:00", to: "17:00" }], tue: [...], ... }.
 * `null` clears the schedule (no schedule = always available while is_available is true). Every problem is
 * collected and returned as a 422 so the caller can fix them all at once. Returns the normalised schedule
 * (windows sorted by start time).
 */
export function validateSchedule(input: unknown): WeeklySchedule | null {
  if (input === null) return null;

  const problems: string[] = [];
  if (!isPlainObject(input)) {
    throw new AppException('INVALID_SCHEDULE', 'The schedule must be an object keyed by day, or null to clear it', 422);
  }
  const keys = Object.keys(input);
  if (keys.length === 0) {
    problems.push('The schedule is empty. Send null to clear it.');
  }

  const result: WeeklySchedule = {};
  for (const key of keys) {
    if (!(DAYS as readonly string[]).includes(key)) {
      problems.push(`"${key}" is not a day. Use ${DAYS.join(', ')}.`);
      continue;
    }
    const windows = input[key];
    if (!Array.isArray(windows)) {
      problems.push(`${key}: expected a list of { from, to } windows.`);
      continue;
    }
    if (windows.length > MAX_WINDOWS_PER_DAY) {
      problems.push(`${key}: at most ${MAX_WINDOWS_PER_DAY} windows per day.`);
      continue;
    }

    const clean: TimeWindow[] = [];
    windows.forEach((w, i) => {
      const label = `${key}[${i}]`;
      if (!isPlainObject(w)) {
        problems.push(`${label}: expected { from, to }.`);
        return;
      }
      const extra = Object.keys(w).filter((k) => k !== 'from' && k !== 'to');
      if (extra.length > 0) problems.push(`${label}: unknown field ${extra.map((e) => `"${e}"`).join(', ')}.`);
      const { from, to } = w;
      if (typeof from !== 'string' || !TIME.test(from)) {
        problems.push(`${label}.from must be a time like "08:00" (00:00 to 23:59).`);
        return;
      }
      if (typeof to !== 'string' || !TIME.test(to)) {
        problems.push(`${label}.to must be a time like "17:00" (00:00 to 23:59).`);
        return;
      }
      if (from >= to) {
        problems.push(`${label}: "from" (${from}) must be before "to" (${to}).`);
        return;
      }
      clean.push({ from, to });
    });

    clean.sort((a, b) => a.from.localeCompare(b.from));
    for (let i = 1; i < clean.length; i++) {
      if (clean[i].from < clean[i - 1].to) problems.push(`${key}: the windows ${clean[i - 1].from}-${clean[i - 1].to} and ${clean[i].from}-${clean[i].to} overlap.`);
    }
    result[key as Day] = clean;
  }

  if (problems.length > 0) {
    throw new AppException('INVALID_SCHEDULE', 'The weekly schedule is not valid', 422, problems);
  }
  return result;
}
