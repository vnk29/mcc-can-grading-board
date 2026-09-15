/**
 * @deprecated
 *
 * This file is a compatibility re-export of the canonical grading engine.
 * It exists only so that any code that previously imported from
 * 'lib/gradingLogic' continues to compile while being migrated.
 *
 * DO NOT add new logic here.
 * DO NOT import from this file in new code.
 * Import directly from '@/lib/grading' instead.
 *
 * This file will be removed once all consumers have been updated.
 */

export {
  evaluateCanTest,
  type CanTestInput as TestValues,
  type CanTestEvaluation as GradingResult,
  type GradingReasonCode as ReasonCode,
} from '@/lib/grading'
