import { MaintenanceCategory, RequestPriority } from '@prisma/client';

/**
 * Deterministic technician ranking (plan/03_module_plan.md, "Ranking"). Pure functions: no database, no AI,
 * the same input always gives the same output. The dispatcher sees every factor and may still pick anyone eligible.
 *
 * NOTE(plan-alignment, for the next developer or agent): the backend plan (maintAIn_Backend_Plan.md, section 7)
 * is the source of truth for this file. An earlier version scored availability as 0 or 1 from a single active
 * job and used a neutral feedback of 0.5. It now follows the plan:
 *   - availability = 1 - activeAssignments / MAX_ACTIVE_ASSIGNMENTS (PENDING, ACCEPTED and IN_PROGRESS all count);
 *   - a technician already at MAX_ACTIVE_ASSIGNMENTS (3) is excluded, not just scored 0;
 *   - feedback is rating / 5, but a technician with fewer than MIN_REVIEWS_FOR_FEEDBACK (3) reviews gets 0.6;
 *   - a technician who already rejected this case is excluded from it.
 * Do not change these numbers here without changing the plan and plan/08_backend_process.md.
 */

export type FactorName = 'skill' | 'availability' | 'experience' | 'feedback' | 'rate';

export type Weights = Record<FactorName, number>;

/** NORMAL and URGENT use the normal weights; EMERGENCY shifts weight from feedback and rate to availability. */
export const WEIGHTS: { normal: Weights; emergency: Weights } = {
  normal: { skill: 0.3, availability: 0.3, experience: 0.15, feedback: 0.15, rate: 0.1 },
  emergency: { skill: 0.3, availability: 0.4, experience: 0.15, feedback: 0.1, rate: 0.05 },
};

export const MAX_PROFICIENCY = 5;
/** Experience counts up to this many years; more does not score higher. */
export const EXPERIENCE_CAP_YEARS = 10;
export const MAX_RATING = 5;
/** Plan: a technician with fewer than 3 reviews has no reliable rating yet and gets a neutral 0.6. */
export const MIN_REVIEWS_FOR_FEEDBACK = 3;
export const NEUTRAL_FEEDBACK = 0.6;
/** Plan: at most 3 open assignments (PENDING, ACCEPTED or IN_PROGRESS) per technician. A config value. */
export const MAX_ACTIVE_ASSIGNMENTS = 3;

export type ExclusionReason =
  | 'ACCOUNT_INACTIVE'
  | 'NOT_AVAILABLE'
  | 'PAYMENT_BLOCKED'
  | 'MISSING_SKILL'
  | 'TOO_MANY_ACTIVE_JOBS'
  | 'REJECTED_THIS_CASE';

/** One approved technician as the ranking sees them. */
export interface TechnicianInput {
  technicianProfileId: string;
  userId: string;
  name: string;
  accountActive: boolean;
  isAvailable: boolean;
  isPaymentBlocked: boolean;
  yearsOfExperience: number;
  rating: number;
  totalReviews: number;
  normalRate: number;
  emergencyRate: number;
  /** The technician's skills with their 1-5 proficiency. */
  skills: { category: MaintenanceCategory; proficiency: number }[];
  /** Open assignments: PENDING, ACCEPTED or IN_PROGRESS. */
  activeAssignments: number;
  /** True when this technician already rejected this very case (the assignment is REJECTED). */
  rejectedThisCase: boolean;
}

export interface RankingRequest {
  priority: RequestPriority;
  category: MaintenanceCategory;
}

export interface RankedCandidate {
  rank: number;
  technicianProfileId: string;
  userId: string;
  name: string;
  /** 0 to 100, two decimals. */
  score: number;
  /** Each factor 0 to 1. */
  factors: Record<FactorName, number>;
  /** weight x factor x 100: how many of the 100 points each factor gave. */
  contributions: Record<FactorName, number>;
  rateUsed: number;
}

export interface ExcludedTechnician {
  technicianProfileId: string;
  name: string;
  reasons: ExclusionReason[];
}

export interface RankingResult {
  priority: RequestPriority;
  category: MaintenanceCategory;
  rateType: 'NORMAL' | 'EMERGENCY';
  weights: Weights;
  ranking: RankedCandidate[];
  excluded: ExcludedTechnician[];
}

const round = (value: number, digits: number) => {
  const m = 10 ** digits;
  return Math.round(value * m) / m;
};

export function weightsFor(priority: RequestPriority): Weights {
  return priority === RequestPriority.EMERGENCY ? WEIGHTS.emergency : WEIGHTS.normal;
}

/** Why a technician cannot be assigned to this request; an empty list means eligible. */
export function exclusionReasons(tech: TechnicianInput, category: MaintenanceCategory): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  if (!tech.accountActive) reasons.push('ACCOUNT_INACTIVE');
  if (!tech.isAvailable) reasons.push('NOT_AVAILABLE');
  if (tech.isPaymentBlocked) reasons.push('PAYMENT_BLOCKED');
  if (!tech.skills.some((s) => s.category === category)) reasons.push('MISSING_SKILL');
  if (tech.activeAssignments >= MAX_ACTIVE_ASSIGNMENTS) reasons.push('TOO_MANY_ACTIVE_JOBS');
  if (tech.rejectedThisCase) reasons.push('REJECTED_THIS_CASE');
  return reasons;
}

export function rankTechnicians(request: RankingRequest, technicians: TechnicianInput[]): RankingResult {
  const emergency = request.priority === RequestPriority.EMERGENCY;
  const weights = weightsFor(request.priority);
  const rateOf = (t: TechnicianInput) => (emergency ? t.emergencyRate : t.normalRate);

  const eligible: TechnicianInput[] = [];
  const excluded: ExcludedTechnician[] = [];
  for (const tech of technicians) {
    const reasons = exclusionReasons(tech, request.category);
    if (reasons.length === 0) eligible.push(tech);
    else excluded.push({ technicianProfileId: tech.technicianProfileId, name: tech.name, reasons });
  }

  // Rate is relative to the other candidates: cheapest = 1, dearest = 0, everyone 1 when they all charge the same.
  const rates = eligible.map(rateOf);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);

  const scored = eligible.map((tech) => {
    const bestProficiency = Math.max(...tech.skills.filter((s) => s.category === request.category).map((s) => s.proficiency));
    const rate = rateOf(tech);
    const factors: Record<FactorName, number> = {
      skill: Math.min(bestProficiency, MAX_PROFICIENCY) / MAX_PROFICIENCY,
      availability: Math.max(0, 1 - tech.activeAssignments / MAX_ACTIVE_ASSIGNMENTS),
      experience: Math.min(Math.max(tech.yearsOfExperience, 0), EXPERIENCE_CAP_YEARS) / EXPERIENCE_CAP_YEARS,
      feedback:
        tech.totalReviews >= MIN_REVIEWS_FOR_FEEDBACK
          ? Math.min(Math.max(tech.rating, 0), MAX_RATING) / MAX_RATING
          : NEUTRAL_FEEDBACK,
      rate: maxRate === minRate ? 1 : 1 - (rate - minRate) / (maxRate - minRate),
    };
    const contributions = {} as Record<FactorName, number>;
    let total = 0;
    for (const name of Object.keys(weights) as FactorName[]) {
      const points = weights[name] * factors[name] * 100;
      contributions[name] = round(points, 2);
      total += points;
      factors[name] = round(factors[name], 4);
    }
    return { tech, rate, factors, contributions, score: round(total, 2) };
  });

  // Highest score first. Ties: more experience, then the lower rate, then a stable id order.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.tech.yearsOfExperience - a.tech.yearsOfExperience ||
      a.rate - b.rate ||
      a.tech.technicianProfileId.localeCompare(b.tech.technicianProfileId),
  );

  return {
    priority: request.priority,
    category: request.category,
    rateType: emergency ? 'EMERGENCY' : 'NORMAL',
    weights,
    ranking: scored.map((s, index) => ({
      rank: index + 1,
      technicianProfileId: s.tech.technicianProfileId,
      userId: s.tech.userId,
      name: s.tech.name,
      score: s.score,
      factors: s.factors,
      contributions: s.contributions,
      rateUsed: s.rate,
    })),
    excluded,
  };
}
