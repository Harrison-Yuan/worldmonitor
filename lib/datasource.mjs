// 数据获取层:按 data/endpoints.json 注册表调用 WorldMonitor 公共 API。
// 只传注册表声明的参数(不传无关参数);超时/错误归一;响应原样透传,保持简洁。
// 运行时唯一外部依赖是网络(fetch);数据来自注入的提供者(见 data-access.mjs)。
import { readDataJson } from './data-access.mjs';

let endpointsCache = null;

export function loadEndpoints() {
  if (endpointsCache) return endpointsCache;
  const registry = readDataJson('endpoints.json');
  endpointsCache = {
    baseUrl: registry.base_url,
    authNote: registry.auth_note,
    byId: new Map(registry.endpoints.map((endpoint) => [endpoint.id, endpoint])),
    list: registry.endpoints,
  };
  return endpointsCache;
}

export function listEndpoints(category) {
  const { list } = loadEndpoints();
  if (!category) return list.map(({ id, method, path, summary, description, auth }) => ({ id, method, path, summary, description, auth }));
  const lower = category.toLowerCase();
  return list
    .filter((endpoint) => `${endpoint.id} ${endpoint.description} ${endpoint.summary}`.toLowerCase().includes(lower))
    .map(({ id, method, path, summary, description, auth }) => ({ id, method, path, summary, description, auth }));
}

export function getEndpoint(endpointId) {
  const { byId } = loadEndpoints();
  return byId.get(endpointId) ?? null;
}

/** 校验参数:只保留注册表声明的字段,required 缺失时报错。 */
export function validateParams(endpoint, params = {}) {
  const errors = [];
  const clean = {};
  for (const param of endpoint.params) {
    if (params[param.name] !== undefined && params[param.name] !== null) {
      let value = params[param.name];
      if (param.type === 'number' && typeof value !== 'number') value = Number(value);
      if (param.type === 'boolean' && typeof value !== 'boolean') value = value === true || value === 'true' || value === '1';
      clean[param.name] = value;
    } else if (param.required) {
      errors.push(`missing required param "${param.name}"`);
    }
  }
  return { clean, errors };
}

function buildUrl(endpoint, cleanParams, baseUrl) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${endpoint.path}`);
  for (const [name, value] of Object.entries(cleanParams)) {
    if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
  }
  return url;
}

/**
 * 调用一个端点。返回统一结构:
 *   { ok: true, data, cached_at?: string, stale?: boolean }
 *   { ok: false, error: string, status?: number, code?: string }
 * 从响应中透传 cached_at / stale(若上游提供),让下游能判断新鲜度。
 */
export async function queryEndpoint(endpointId, params = {}, { baseUrl, apiKey, timeoutMs = 15000, fetchImpl } = {}) {
  const endpoint = getEndpoint(endpointId);
  if (!endpoint) {
    return { ok: false, error: `unknown endpoint "${endpointId}" — call list_endpoints first`, code: 'unknown_endpoint' };
  }
  const { clean, errors } = validateParams(endpoint, params);
  if (errors.length > 0) {
    return { ok: false, error: errors.join('; '), code: 'invalid_params' };
  }

  const resolvedBase = baseUrl || loadEndpoints().baseUrl;
  const url = buildUrl(endpoint, clean, resolvedBase);
  const fetchFn = fetchImpl || globalThis.fetch;
  const headers = {
    'User-Agent': 'worldmonitor-knowledge-mcp/0.2.0',
    Accept: 'application/json',
  };
  if (apiKey) headers['X-WorldMonitor-Key'] = apiKey;

  try {
    const response = await fetchFn(url.toString(), {
      method: endpoint.method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        ok: false,
        error: `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        status: response.status,
        code: response.status === 401 || response.status === 403 ? 'auth_required' : 'http_error',
      };
    }
    const payload = await response.json().catch(() => null);
    if (payload === null) {
      return { ok: false, error: 'response is not valid JSON', code: 'bad_response' };
    }
    // 透传上游新鲜度信封(若存在),供下游判断数据是否可用
    const out = { ok: true, data: payload };
    if (typeof payload === 'object' && payload !== null) {
      if (typeof payload.cached_at === 'string') out.cached_at = payload.cached_at;
      if (typeof payload.stale === 'boolean') out.stale = payload.stale;
    }
    return out;
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || /abort/i.test(String(error?.message ?? ''));
    return {
      ok: false,
      error: timedOut ? `timeout after ${timeoutMs}ms` : String(error?.message ?? error),
      code: timedOut ? 'timeout' : 'network_error',
    };
  }
}
