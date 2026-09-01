/**
 * A two-state return value. Used at every module boundary in place of thrown
 * exceptions, so that expected outcomes -- a repository that does not exist, a
 * rate-limited upstream, a manifest that is not JSON -- travel as data the UI
 * can render rather than as control flow the UI has to catch.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
