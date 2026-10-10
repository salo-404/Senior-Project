/**
 * technician_tier_requests has no column for "the skills this request asks for", and the only allowed schema
 * change in this task is the audit action. A TIER_UPDATE request therefore keeps its notes and requested skills
 * together in supporting_notes as a small JSON text. INITIAL_APPLICATION rows keep plain text as before.
 * SCHEMA GAP: a `requested_skill_ids` column (or a join table) would remove this encoding.
 */
export interface TierUpdatePayload {
  notes: string;
  skill_ids: string[];
  /** True when the nightly job proposed the request, false when the technician did. */
  suggested?: boolean;
}

export function encodePayload(payload: TierUpdatePayload): string {
  return JSON.stringify(payload);
}

/** Tolerant: a value that is not our JSON (plain text, null) is read as notes only. */
export function decodePayload(text: string | null): TierUpdatePayload {
  if (!text) return { notes: '', skill_ids: [] };
  try {
    const parsed = JSON.parse(text) as Partial<TierUpdatePayload>;
    if (parsed && typeof parsed === 'object' && typeof parsed.notes === 'string') {
      return {
        notes: parsed.notes,
        skill_ids: Array.isArray(parsed.skill_ids) ? parsed.skill_ids.filter((s): s is string => typeof s === 'string') : [],
        ...(parsed.suggested ? { suggested: true } : {}),
      };
    }
  } catch {
    // fall through: plain text
  }
  return { notes: text, skill_ids: [] };
}
