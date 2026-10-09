import { Injectable } from '@nestjs/common';
import { CONFIRMATION_QUESTIONS, SAFETY_CATEGORIES, SAFETY_RULES, SafetyCategory, normalize } from './safety.rules';

export interface SafetyResult {
  hit: boolean;
  categories: SafetyCategory[];
}


/**
 * Pure rules: no database, no AI. They keep working in every mode.
 * A keyword alone never escalates; only a clear Yes does, through RequestsService.escalate().
 */
@Injectable()
export class SafetyService {
  /** Returns the categories whose keywords appear in the text. */
  evaluateText(text: string | null | undefined): SafetyResult {
    if (!text) return { hit: false, categories: [] };
    const normalized = normalize(text);
    const categories = SAFETY_CATEGORIES.filter((category) =>
      SAFETY_RULES[category].some((rule) => rule.test(normalized)),
    );
    return { hit: categories.length > 0, categories };
  }

  /**
   * Reads the intake form's safety question: `safety_concern` is a boolean and `true` means the customer
   * answered Yes. That Yes is a clear confirmation, so no categories are attached. Anything else is no hit.
   */
  evaluateIntake(intakeAnswers: unknown): SafetyResult {
    if (!intakeAnswers || typeof intakeAnswers !== 'object' || Array.isArray(intakeAnswers)) {
      return { hit: false, categories: [] };
    }
    const answers = intakeAnswers as Record<string, unknown>;
    return answers.safety_concern === true ? { hit: true, categories: [] } : { hit: false, categories: [] };
  }

  /**
   * Fixed question text per category. Arabic for Arabic scripts and dialects; English for English and for
   * Arabizi ("ar-latn"), whose speakers read Latin script.
   */
  confirmationQuestion(category: SafetyCategory, language?: string | null): string {
    const lang = (language ?? 'en').toLowerCase();
    const arabic = lang.startsWith('ar') && lang !== 'ar-latn';
    const entry = CONFIRMATION_QUESTIONS[category];
    return arabic ? entry.ar : entry.en;
  }
}
