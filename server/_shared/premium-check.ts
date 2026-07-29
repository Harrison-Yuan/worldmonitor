import {
  type BillingVerificationDenial,
} from './entitlement-check';

export type PremiumCallerIdentity =
  | { isPremium: true; userId: string; kind: 'internal-mcp'; quotaExempt: true }
  | { isPremium: true; userId: string; kind: 'user-api-key' | 'bearer'; quotaExempt: false }
  | { isPremium: true; userId: null; kind: 'enterprise'; quotaExempt: true }
  | {
    isPremium: false;
    userId: null;
    kind: null;
    quotaExempt: false;
    /**
     * The billing-verification classification behind this denial, when the
     * denial rests on something OTHER than a confirmed non-premium answer
     * (#5622) — a lookup that failed, a renewal re-check in flight, or a
     * provider-confirmed lapse. Absent for a genuine free/unauthenticated
     * caller.
     *
     * The field is additive and optional on purpose: `isPremium: false` keeps
     * its exact meaning ("do not grant premium"), so all ~25 existing callers
     * — including every `isCallerPremium()` boolean consumer — are unaffected.
     * A caller that wants the retryable posture opts in by reading this and
     * rendering it via renderBillingVerificationDenial instead of a terminal 403.
     *
     * It carries the whole classification rather than a boolean because there
     * are FOUR of these states, not one. An earlier version of this field was
     * `verificationUnavailable?: true`, which silently dropped
     * `renewal_verification_pending` / `renewal_verification_failed` — states
     * convex/http.ts really does emit — back onto the terminal upsell, i.e. the
     * exact #5600 failure mode this field exists to remove.
     */
    billingDenial?: BillingVerificationDenial;
  };

type RpcApiErrorLike = Error & {
  statusCode: number;
  body: string;
  retryAfter?: number;
  exposeMessage?: boolean;
};

type RpcApiErrorConstructor<T extends RpcApiErrorLike> =
  new (statusCode: number, message: string, body: string) => T;

type PremiumRpcBillingApiError<T extends RpcApiErrorLike> = T & {
  billingVerificationCode: BillingVerificationDenial['code'];
};

/**
 * RPC billing denials have two transport shapes:
 * - response-envelope RPCs use `ServiceError` for retryable verification
 *   states and `AuthError` for the provider-confirmed terminal lapse;
 * - exception-style RPCs throw their generated service's own `ApiError`.
 *
 * Both put the stable billing code in `statusDetail`/`ApiError.body`. Confirmed
 * free and unauthenticated callers have no billing denial and keep the
 * handler's existing Pro-required rendering.
 */
export function getPremiumRpcBillingErrorType(
  denial: BillingVerificationDenial,
): 'AuthError' | 'ServiceError' {
  return denial.retryable ? 'ServiceError' : 'AuthError';
}

function createPremiumRpcBillingDenialError<T extends RpcApiErrorLike>(
  identity: PremiumCallerIdentity,
  ApiErrorConstructor: RpcApiErrorConstructor<T>,
): PremiumRpcBillingApiError<T> | null {
  if (identity.isPremium || !identity.billingDenial) return null;
  const denial = identity.billingDenial;

  const error = new ApiErrorConstructor(
    denial.status,
    denial.message,
    denial.code,
  ) as PremiumRpcBillingApiError<T>;
  error.billingVerificationCode = denial.code;
  if (denial.status === 503) {
    error.retryAfter = denial.retryAfterSeconds;
    error.exposeMessage = true;
  }
  return error;
}

/**
 * Enforces a hard-denying premium RPC gate while preserving why verification
 * failed. The generated constructor keeps `instanceof ApiError` service-local;
 * the fallback message preserves each endpoint's existing `PRO`/`Pro` copy.
 */
export async function requirePremiumRpcAccess<T extends RpcApiErrorLike>(
  request: Request,
  ApiErrorConstructor: RpcApiErrorConstructor<T>,
  fallbackMessage: string,
): Promise<void> {
  const identity = await resolvePremiumCallerIdentity(request);
  if (identity.isPremium) return;

  const billingError = createPremiumRpcBillingDenialError(identity, ApiErrorConstructor);
  if (billingError) throw billingError;
  throw new ApiErrorConstructor(403, fallbackMessage, '');
}

/**
 * Resolves premium status and the user-bound identity for spend controls.
 */
export async function resolvePremiumCallerIdentity(_request: Request): Promise<PremiumCallerIdentity> {
  // Premium gating is disabled — all callers treated as enterprise.
  return { isPremium: true, userId: null, kind: 'enterprise', quotaExempt: true };
}

/**
 * Pro/premium gating is disabled in this deployment.
 * All callers are treated as premium.
 */
export async function isCallerPremium(_request: Request): Promise<boolean> {
  return true;
}
