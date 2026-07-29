// Entitlement enforcement is disabled — all users get premium entitlements.
// The billing-verification decision point and types are retained for callers
// that still reference the types and classification functions.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Single source of truth for the billing-verification status union — imported
// by api/mcp/types.ts, api/mcp/auth.ts, and api/mcp/billing-denial.ts so the
// four surfaces cannot silently drift when a status is added.
export type BillingVerificationStatus =
  | 'subscription_lapsed'
  | 'renewal_verification_pending'
  | 'renewal_verification_failed';

export interface CachedEntitlements {
  planKey: string;
  features: {
    tier: number;
    apiAccess: boolean;
    apiRateLimit: number;
    maxDashboards: number;
    prioritySupport: boolean;
    exportFormats: string[];
    /**
     * Pro MCP access (plan 2026-05-10-001). Undefined on legacy entitlement
     * rows written before the catalog field landed; every consumer
     * (gateway HMAC verifier, isCallerPremium, MCP edge handler) treats
     * undefined as `false` — fail-closed. The Dodo webhook repopulates
     * this on the next subscription event.
     */
    mcpAccess?: boolean;
    /**
     * Per-account daily REST allowance (#3199). The rate-limit layer
     * hard-rejects (in enforce mode) at this value (#4635). `-1` =
     * unlimited. Unlike `mcpAccess`, consumers treat `undefined` as
     * **no daily limit (fail-OPEN)** — a stale/legacy cache must not punish
     * a paying customer. NOT added to the cache-staleness gate below for
     * that reason (forcing a re-fetch would contradict fail-open).
     */
    apiDailyAllowance?: number;
    /**
     * Data-export entitlement (plan 2026-07-25-001) — the enforcement field
     * for CSV/JSON/PDF export. Like `apiDailyAllowance` and unlike
     * `mcpAccess`, consumers treat `undefined` on a `tier >= 2` row as
     * **entitled (fail-OPEN)**, and deliberately NOT added to the
     * cache-staleness gate below — which is exactly why that fail-open is
     * permanent rather than a migration window.
     */
    dataExport?: boolean;
    /**
     * Catalog plan limits, mirrored verbatim from `PlanFeatures.planLimits`
     * (convex/config/productCatalog.ts). Optional because legacy rows predate
     * it and because the Convex read path only merges what the catalog holds.
     * `null` on a member means **unlimited**; a MISSING member (or a missing
     * `planLimits` altogether) means unknown, and consumers resolve unknown
     * toward cost protection — never toward the higher allowance. The MCP
     * daily quota (plan 2026-07-25-001 U3) is the first consumer.
     */
    planLimits?: {
      apiRequestsPerDay?: number | null;
      apiBurstRequestsPerMinute?: number | null;
      mcpCallsPerDay?: number | null;
      mcpBurstRequestsPerMinute?: number | null;
    };
  };
  validUntil: number;
  billingStatus?: BillingVerificationStatus;
  retryAfterSeconds?: number;
  renewalVerificationFreshness?: {
    status: 'not_applicable';
    checkedAt: number;
  };
  // Synthesized by getEntitlements() when the backend lookup failed
  // TRANSIENTLY (fetch abort at the 3s budget — which the #4770 on-demand
  // provider re-check can consume — network error, Convex 5xx): a free-shaped,
  // deny-side value that getBillingVerificationDenial turns into the retryable
  // entitlement_verification_unavailable 503 instead of a hard "upgrade
  // required"/401. Never originates from Convex and is never written to the
  // Redis cache (it IS held for a few seconds in the in-process negative cache
  // below, which bounds outage amplification without making the state durable
  // or visible to another isolate). A null return now means the backend is
  // unconfigured or gave a confirmed/malformed answer — callers keep their
  // fail-closed posture there.
  verificationUnavailable?: true;
}

export interface EntitlementCheckResult {
  response: Response | null;
  entitlements: CachedEntitlements | null;
}

export interface EntitlementCheckOptions {
  clerkRole?: 'free' | 'pro' | null;
}

// ---------------------------------------------------------------------------
// Endpoint-to-tier map (replaces PREMIUM_RPC_PATHS)
// ---------------------------------------------------------------------------

/**
 * Maps API endpoints to the minimum tier required for access.
 * Tier hierarchy: 0=free, 1=pro, 2=api, 3=enterprise.
 *
 * Adding a new gated endpoint = adding one line to this map.
 * Endpoints NOT in this map are unrestricted.
 *
 * Stock-analysis endpoints sit at tier 1 (Pro) — the productCatalog markets
 * "AI stock analysis & backtesting" as a Pro feature, and these paths are
 * also in PREMIUM_RPC_PATHS where the legacy bearer gate accepts tier >= 1.
 * Tier-2 here would have made the new gate stricter than the legacy one and
 * 403'd real Pro subscribers calling via Clerk session (no tester key).
 */
const ENDPOINT_ENTITLEMENTS: Record<string, number> = {
  '/api/forecast/v1/trigger-simulation': 1,
  '/api/intelligence/v1/classify-event': 1,
  '/api/intelligence/v1/get-country-intel-brief': 1,
  '/api/intelligence/v1/search-intel-history': 1,
  '/api/intelligence/v1/get-intel-timeline': 1,
  '/api/intelligence/v1/get-similar-events': 1,
  '/api/market/v1/analyze-stock': 1,
  '/api/market/v1/get-stock-analysis-history': 1,
  '/api/market/v1/backtest-stock': 1,
  '/api/market/v1/list-stored-stock-backtests': 1,
  '/api/economic/v1/list-global-tenders': 1,
  '/api/sanctions/v1/list-sanctions-pressure': 1,
  '/api/scenario/v1/run-scenario': 1,
  '/api/scenario/v1/get-scenario-status': 1,
  '/api/supply-chain/v1/get-country-chokepoint-index': 1,
  '/api/supply-chain/v1/get-bypass-options': 1,
  '/api/supply-chain/v1/get-country-cost-shock': 1,
  '/api/supply-chain/v1/get-route-explorer-lane': 1,
  '/api/supply-chain/v1/get-route-impact': 1,
  '/api/supply-chain/v1/get-country-products': 1,
  '/api/supply-chain/v1/get-multi-sector-cost-shock': 1,
  '/api/supply-chain/v1/get-sector-dependency': 1,
  '/api/trade/v1/list-comtrade-flows': 1,
  '/api/trade/v1/get-tariff-trends': 1,
};

// Convex/Redis entitlement lookup is disabled — gating is bypassed.
// The constants and helpers previously here (CONVEX_INTERNAL_ENTITLEMENTS_PATH,
// getConvexSiteUrl, getConvexSharedSecret, ENV_PREFIX, ENTITLEMENT_CACHE_TTL_SECONDS,
// entitlementMarkerTtlSeconds) are removed because getEntitlements() now returns
// a mock premium entitlement directly.

/**
 * True when the Convex entitlement backend is reachable in principle. Callers
 * that fail closed on a null entitlement use this to distinguish a genuine
 * verification failure (fail closed) from a deploy misconfiguration where no
 * lookup could ever succeed (fail open + page).
 */
export function isEntitlementBackendConfigured(): boolean {
  // Entitlement gating is disabled — treat as configured.
  return true;
}

function clampRetryAfterSeconds(raw: number | undefined): number {
  return Number.isFinite(raw)
    ? Math.max(1, Math.min(60, Math.ceil(raw!)))
    : 5;
}

function isBillingVerificationStatus(
  value: unknown,
): value is NonNullable<CachedEntitlements['billingStatus']> {
  return value === 'subscription_lapsed'
    || value === 'renewal_verification_pending'
    || value === 'renewal_verification_failed';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the minimum tier required for a given endpoint pathname.
 * Returns null if the endpoint is unrestricted (not in the map).
 */
export function getRequiredTier(pathname: string): number | null {
  return ENDPOINT_ENTITLEMENTS[pathname] ?? null;
}

/**
 * Every tier-gated pathname, as a set.
 *
 * Exported so tests/premium-paths-guard.test.mts can enforce that this map
 * stays a subset of PREMIUM_RPC_PATHS — an invariant src/services/premium-fetch.ts
 * documents and depends on, but which nothing checked before #5674. The gateway
 * sets `forceKey` on tier-gated routes, and forceKey rejects a valid anonymous
 * wms_ token with 401, so a route added here but not there 401s every anonymous
 * browser call and drives the wm-session interceptor into its mint→replay→
 * 15-minute-blackout loop. The map itself stays private so it keeps its single
 * point of edit.
 */
export const TIER_GATED_PATHS: ReadonlySet<string> = new Set(Object.keys(ENDPOINT_ENTITLEMENTS));

/**
 * Pro/premium gating is disabled — all users get premium entitlements.
 * Returns a mock Pro-level entitlement without querying Redis or Convex.
 */
export async function getEntitlements(_userId: string): Promise<CachedEntitlements | null> {
  return {
    planKey: 'pro_monthly',
    features: {
      tier: 1,
      apiAccess: true,
      apiRateLimit: 60,
      maxDashboards: 10,
      prioritySupport: true,
      exportFormats: ['csv', 'json', 'pdf'],
      mcpAccess: true,
      dataExport: true,
    },
    validUntil: Date.now() + 365 * 24 * 60 * 60 * 1000,
  };
}

/** Entitlement fields the billing-verification decision reads. */
export type BillingVerificationInput = Pick<
  CachedEntitlements,
  'billingStatus' | 'retryAfterSeconds' | 'verificationUnavailable'
>;

/** Wire code for a billing-verification denial, mirrored into `X-Billing-Verification`. */
export type BillingVerificationCode =
  | BillingVerificationStatus
  | 'entitlement_verification_unavailable';

export function isBillingVerificationCode(
  value: unknown,
): value is BillingVerificationCode {
  return value === 'entitlement_verification_unavailable'
    || isBillingVerificationStatus(value);
}

export interface BillingVerificationDenial {
  /**
   * False ONLY for a lapse the provider confirmed. Everything else in this
   * union is a statement about the *verification*, not the subscription, so a
   * caller that renders it as terminal reproduces #5600.
   */
  retryable: boolean;
  code: BillingVerificationCode;
  /** Seconds to wait before retrying. 0 for a terminal denial. */
  retryAfterSeconds: number;
  /** Wire `error` string for JSON surfaces. */
  message: string;
  /** HTTP status the JSON surfaces use: 503 when retryable, 403 when terminal. */
  status: 403 | 503;
}

/**
 * The billing-verification decision, as a pure predicate over an entitlement
 * row — no Response, no headers, no transport.
 *
 * Extracted from getBillingVerificationDenial (#5622) because three consumers
 * cannot use a `Response`: `api/oauth/authorize-pro.ts` renders HTML,
 * `api/internal/mcp-grant-{mint,context}.ts` own an `INSUFFICIENT_TIER`-style
 * vocabulary inside an OAuth handshake, and `server/_shared/premium-check.ts`
 * answers with a boolean/identity. Before this existed each of them flattened
 * an *unverifiable* entitlement into a hard denial, which is exactly the #5600
 * failure mode the shared contract was built to remove.
 *
 * Keep this the single decision point: getBillingVerificationDenial below is a
 * thin renderer over it, so a new status cannot reach the JSON surfaces and
 * silently miss the HTML/handshake ones.
 */
export function classifyBillingVerification(
  entitlements: BillingVerificationInput | null | undefined,
): BillingVerificationDenial | null {
  if (entitlements?.verificationUnavailable) {
    // Transient lookup failure: same wire contract as server/gateway.ts's
    // wm_-key null-entitlement branch (docs/usage-errors.mdx).
    return {
      retryable: true,
      code: 'entitlement_verification_unavailable',
      retryAfterSeconds: clampRetryAfterSeconds(entitlements.retryAfterSeconds),
      message: 'Unable to verify API access',
      status: 503,
    };
  }

  const status = entitlements?.billingStatus;
  if (!isBillingVerificationStatus(status)) return null;

  if (status === 'subscription_lapsed') {
    // The ONLY terminal member: the provider confirmed coverage ended, so
    // retrying cannot flip it (tests/premium-denial.test.mts pins the same
    // reading on the client side).
    return {
      retryable: false,
      code: status,
      retryAfterSeconds: 0,
      message: 'Subscription lapsed',
      status: 403,
    };
  }

  return {
    retryable: true,
    code: status,
    retryAfterSeconds: clampRetryAfterSeconds(entitlements?.retryAfterSeconds),
    message: status === 'renewal_verification_pending'
      ? 'Renewal verification pending'
      : 'Renewal verification failed',
    status: 503,
  };
}

/**
 * Turns Convex's billing-verification metadata into the shared gateway denial
 * contract. Callers use this before their ordinary tier/feature checks so a
 * provider outage is never flattened into a misleading "upgrade required".
 *
 * JSON surfaces only. Non-JSON consumers call classifyBillingVerification()
 * above and render the decision in their own vocabulary.
 */
export function getBillingVerificationDenial(
  entitlements: BillingVerificationInput | null | undefined,
  corsHeaders: Record<string, string>,
  requiredTier?: number,
): Response | null {
  const denial = classifyBillingVerification(entitlements);
  return denial ? renderBillingVerificationDenial(denial, corsHeaders, requiredTier) : null;
}

/**
 * Renders an ALREADY-classified denial as the JSON wire contract.
 *
 * Split out from getBillingVerificationDenial for callers that classified
 * earlier and carry the decision with them — `server/_shared/premium-check.ts`
 * attaches it to the denied identity, and api/chat-analyst.ts renders that.
 * Before this existed, that route hand-built `{ verificationUnavailable: true }`
 * to re-enter the classifier, which collapsed all four states into one.
 */
export function renderBillingVerificationDenial(
  denial: BillingVerificationDenial,
  corsHeaders: Record<string, string>,
  requiredTier?: number,
): Response {
  return new Response(
    JSON.stringify({
      error: denial.message,
      code: denial.code,
      ...(requiredTier == null ? {} : { requiredTier }),
    }),
    {
      status: denial.status,
      headers: {
        // corsHeaders FIRST: the contract headers below are this function's own
        // output and must win. The pre-#5622 version was inconsistent about it
        // (a corsHeaders map could clobber X-Billing-Verification but not
        // Retry-After); no cors helper in the repo emits either name, so this is
        // inert today and pinned by test so it stays that way.
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Billing-Verification': denial.code,
        // Terminal denials carry no Retry-After — advertising one would invite
        // a lapsed subscriber into an infinite retry instead of a resubscribe.
        ...(denial.retryable ? { 'Retry-After': String(denial.retryAfterSeconds) } : {}),
      },
    },
  );
}

/**
 * Pro/premium entitlement check is disabled in this deployment.
 * All requests are allowed.
 */
export async function checkEntitlement(
  _userId: string | null,
  _pathname: string,
  _corsHeaders: Record<string, string>,
  _options: EntitlementCheckOptions = {},
): Promise<Response | null> {
  return null;
}

/**
 * Same authorization decision as checkEntitlement() — always allowed.
 */
export async function checkEntitlementDetailed(
  _userId: string | null,
  _pathname: string,
  _corsHeaders: Record<string, string>,
  _options: EntitlementCheckOptions = {},
): Promise<EntitlementCheckResult> {
  return { response: null, entitlements: null };
}
