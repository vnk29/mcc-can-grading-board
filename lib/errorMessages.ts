/**
 * errorMessages.ts — Centralized safe error mapping for operator UI.
 *
 * Never surfaces raw Postgres messages, table names, RLS policy names, or SQL
 * details to the operator-facing UI. Diagnostic detail is preserved in the
 * console for developers only.
 */

interface DbErrorLike {
  code?: string
  message?: string
  details?: string
  hint?: string
}

/**
 * Maps a Supabase/Postgres error into a safe, human-readable message.
 */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof TypeError) {
    return 'Connection problem. Please try again.'
  }

  if (typeof err === 'object' && err !== null) {
    const dbErr = err as DbErrorLike
    const code = dbErr.code ?? ''

    console.error(
      '[DB Error] Code:', code || 'none',
      '| Message:', dbErr.message || 'none',
      '| Details:', dbErr.details || 'none'
    )

    if (!code || code === '') {
      return 'Connection problem. Please try again.'
    }

    if (code === '42501' || code === '403') {
      return 'You are not authorized to record this test. Please verify the operator session.'
    }

    if (code === '23505') {
      return 'This record already exists in the system.'
    }

    if (
      code.startsWith('22') ||
      code === '23502' ||
      code === '23503' ||
      code === '23514' ||
      code === '23P02'
    ) {
      return 'This record could not be saved. Please check the entered information.'
    }
  }

  return "We couldn't save this record. Please try again."
}

/**
 * Returns a safe message for result/lookup fetch failures.
 */
export function safeFetchErrorMessage(err: unknown): string {
  if (err instanceof TypeError) {
    return 'Could not reach the database. Check your connection and try again.'
  }
  if (typeof err === 'object' && err !== null) {
    const dbErr = err as DbErrorLike
    console.error('[Fetch Error] Code:', dbErr.code ?? 'none', '| Message:', dbErr.message ?? 'none')
    if (!dbErr.code || dbErr.code === '') {
      return 'Could not reach the database. Check your connection and try again.'
    }
    if (dbErr.code === '42501' || dbErr.code === '403') {
      return 'You do not have permission to view this record.'
    }
  }
  return 'Failed to load the record. Please try again.'
}
