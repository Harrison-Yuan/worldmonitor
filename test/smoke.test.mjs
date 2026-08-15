import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { setDataProvider } from '../lib/data-access.mjs';
import { loadKnowledge, planAnalysis, searchKnowledge } from '../lib/knowledge.mjs';
import { listEndpoints, getEndpoint, queryEndpoint, loadEndpoints } from '../lib/datasource.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 数据提供者:本地从 data/ 读文件(lib 模块不 import node:*,由入口注入)
setDataProvider((rel) => readFileSync(join(ROOT, 'data', rel), 'utf8'));

describe('知识数据加载', () => {
  it('全部 JSON 可解析,路由/源/信号/负知识非空', () => {
    const knowledge = loadKnowledge();
    assert.ok(knowledge.routes.length >= 8, `routes=${knowledge.routes.length}`);
    assert.ok(knowledge.sourcesById.size >= 30, `sources=${knowledge.sourcesById.size}`);
    assert.ok(knowledge.signalsById.size >= 10, `signals=${knowledge.signalsById.size}`);
    assert.ok(knowledge.lessons.length >= 30, `lessons=${knowledge.lessons.length}`);
  });

  it('路由引用的数据源/信号 id 全部存在于注册表(无悬空引用)', () => {
    const knowledge = loadKnowledge();
    const missing = [];
    for (const route of knowledge.routes) {
      for (const sourceId of route.sources) {
        if (!knowledge.sourcesById.has(sourceId)) missing.push(`source:${sourceId}`);
      }
      for (const signalId of route.signals) {
        if (!knowledge.signalsById.has(signalId)) missing.push(`signal:${signalId}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});

describe('planAnalysis 路由', () => {
  it('冲突类提问命中 conflict 路线,含信息需求/源/验证/推荐工具', () => {
    const plan = planAnalysis('台湾海峡局势是否升级,对半导体供应链意味着什么?');
    assert.equal(plan.fallback_used, false);
    assert.ok(plan.matched_routes.length >= 1);
    const conflict = plan.matched_routes.find((route) => route.id === 'conflict');
    assert.ok(conflict, `expect conflict route, got: ${plan.matched_routes.map((r) => r.id).join(',')}`);
    assert.ok(conflict.information_needs.length > 0);
    assert.ok(conflict.sources.some((source) => source.id === 'acled'));
    assert.ok(conflict.verification.length > 0);
    assert.ok(conflict.recommended_tools.includes('get_conflict_events'));
    assert.ok(conflict.output_framework.length > 0);
  });

  it('多主题提问可返回多个路线,受 max_routes 限制', () => {
    const plan = planAnalysis('网络攻击和自然灾害', { maxRoutes: 2 });
    assert.ok(plan.matched_routes.length <= 2);
    assert.ok(plan.matched_routes.length >= 1);
  });

  it('无命中时回退国家综合风险并标记 fallback_used', () => {
    const plan = planAnalysis('zzzz 无意义提问 qqqqq', {});
    assert.equal(plan.fallback_used, true);
    assert.equal(plan.matched_routes[0].id, 'country_risk');
  });

  it('社会经济民生问题命中 socioeconomic 路线(中国/普通人/大环境)', () => {
    const plan = planAnalysis('当前中国的大环境对普通人意味着什么？');
    assert.equal(plan.fallback_used, false);
    const socio = plan.matched_routes.find((route) => route.id === 'socioeconomic');
    assert.ok(socio, `expect socioeconomic route, got: ${plan.matched_routes.map((r) => r.id).join(',')}`);
    assert.ok(socio.sources.some((source) => source.id === 'nbs-china'));
    assert.ok(socio.sources.some((source) => source.id === 'pboc-china'));
    assert.ok(socio.output_framework.some((line) => line.includes('普通人')));
  });

  it('中国国家问题同时命中 socioeconomic 与 country_risk', () => {
    const plan = planAnalysis('当前中国的大环境对普通人意味着什么？', { maxRoutes: 5 });
    const ids = plan.matched_routes.map((route) => route.id);
    assert.ok(ids.includes('socioeconomic'));
    assert.ok(ids.includes('country_risk'));
  });

  it('路由输出带可执行端点建议(conflict → list-acled-events)', () => {
    const plan = planAnalysis('台海军事冲突升级');
    const conflict = plan.matched_routes.find((route) => route.id === 'conflict');
    assert.ok(conflict, 'expect conflict route');
    assert.ok(conflict.endpoints.some((e) => e.id === 'list-acled-events'), 'conflict should suggest list-acled-events');
    assert.ok(conflict.endpoints.every((e) => e.path.startsWith('/api/')), 'endpoints carry real paths');
  });

  it('过短提问返回空计划', () => {
    const plan = planAnalysis('a');
    assert.deepEqual(plan.matched_routes, []);
  });
});

describe('searchKnowledge 检索', () => {
  it('fail-closed 命中负知识 lessons', () => {
    const result = searchKnowledge('fail-closed');
    assert.ok(result.hits.some((hit) => hit.category === 'lesson'));
  });

  it('category 限定只返回该类', () => {
    const result = searchKnowledge('ACLED', { category: 'sources' });
    assert.ok(result.hits.every((hit) => hit.category === 'source'));
    assert.ok(result.hits.some((hit) => hit.id === 'acled'));
  });

  it('多词查询按词切分(OR),返回命中词数排序', () => {
    const result = searchKnowledge('经济 就业 债务');
    assert.ok(result.hits.length > 0, 'multi-term query must return hits');
    const scores = result.hits.map((hit) => hit.matched.length);
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(scores[i - 1] >= scores[i], 'hits must be sorted by matched term count');
    }
  });
});

describe('MCP stdio 协议', () => {
  let child;
  let pending = new Map();
  let nextId = 1;

  before(async () => {
    child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.on('data', () => {});
    child.stdout.setEncoding('utf8');
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  after(() => {
    if (child) child.kill();
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  it('initialize 握手返回 serverInfo 与 tools 能力', async () => {
    const response = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    assert.equal(response.result.serverInfo.name, 'worldmonitor-knowledge-mcp');
    assert.ok(response.result.capabilities.tools);
  });

  it('tools/list 暴露 plan_analysis 与 search_knowledge', async () => {
    const response = await request('tools/list', {});
    const names = response.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('plan_analysis'));
    assert.ok(names.includes('search_knowledge'));
  });

  it('tools/call plan_analysis 返回结构化分析计划', async () => {
    const response = await request('tools/call', {
      name: 'plan_analysis',
      arguments: { query: '以色列空袭对能源市场的传导' },
    });
    assert.equal(response.result.content[0].type, 'text');
    const payload = JSON.parse(response.result.content[0].text);
    assert.ok(payload.matched_routes.length >= 1);
    assert.ok(payload.matched_routes[0].sources.length > 0);
  });

  it('tools/call 未知工具返回 -32602', async () => {
    const response = await request('tools/call', { name: 'no_such_tool', arguments: {} });
    assert.equal(response.error.code, -32602);
  });
});

describe('数据获取层 datasource(mock fetch)', () => {
  it('端点注册表加载:核心端点与参数存在', () => {
    const { list } = loadEndpoints();
    assert.ok(list.length >= 50, `endpoints=${list.length}`);
    const risk = getEndpoint('get-risk-scores');
    assert.equal(risk.path, '/api/intelligence/v1/get-risk-scores');
    assert.ok(risk.params.some((p) => p.name === 'region'));
  });

  it('listEndpoints 支持关键词过滤', () => {
    const all = listEndpoints();
    const filtered = listEndpoints('chokepoint');
    assert.ok(filtered.length > 0 && filtered.length < all.length);
    assert.ok(filtered.every((e) => e.id.includes('chokepoint') || e.description.includes('咽喉')));
  });

  it('queryEndpoint 成功:只传声明参数、带 User-Agent、透传 cached_at', async () => {
    let capturedUrl = null;
    let capturedHeaders = null;
    const fakeFetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      return {
        ok: true,
        json: async () => ({ ciiScores: [{ countryCode: 'TW' }], cached_at: '2026-08-01T00:00:00Z', stale: false }),
      };
    };
    const result = await queryEndpoint('get-risk-scores', { region: 'APAC', ignored_extra: 123 }, { baseUrl: 'https://wm.test', fetchImpl: fakeFetch });
    assert.equal(result.ok, true);
    assert.equal(result.cached_at, '2026-08-01T00:00:00Z');
    assert.equal(capturedUrl, 'https://wm.test/api/intelligence/v1/get-risk-scores?region=APAC');
    // 无关参数被过滤,不会出现在 URL 中
    assert.ok(!capturedUrl.includes('ignored_extra'));
    assert.ok(capturedHeaders['User-Agent'].startsWith('worldmonitor-knowledge-mcp'));
  });

  it('queryEndpoint 校验:required 缺失与未知端点', async () => {
    const missing = await queryEndpoint('lookup-sanction-entity', {}, { fetchImpl: async () => { throw new Error('should not fetch'); } });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'invalid_params');
    const unknown = await queryEndpoint('no-such-endpoint', {}, { fetchImpl: async () => { throw new Error('should not fetch'); } });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'unknown_endpoint');
  });

  it('queryEndpoint 错误归一:401 → auth_required,超时 → timeout', async () => {
    const auth = await queryEndpoint('get-risk-scores', {}, {
      baseUrl: 'https://wm.test',
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
    });
    assert.equal(auth.ok, false);
    assert.equal(auth.code, 'auth_required');

    const timeout = await queryEndpoint('get-risk-scores', {}, {
      baseUrl: 'https://wm.test',
      timeoutMs: 5,
      fetchImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error('The operation was aborted due to timeout');
      },
    });
    assert.equal(timeout.ok, false);
    assert.equal(timeout.code, 'timeout');
  });
});

describe('MCP 协议扩展(2025-11-25 / resources / isError)', () => {
  let child;
  let pending = new Map();
  let nextId = 1;

  before(async () => {
    child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WM_API_BASE: 'https://wm.test' },
    });
    child.stderr.on('data', () => {});
    child.stdout.setEncoding('utf8');
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  after(() => {
    if (child) child.kill();
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  it('initialize 2025-11-25 版本被回响,声明 resources 能力', async () => {
    const response = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
    assert.equal(response.result.protocolVersion, '2025-11-25');
    assert.ok(response.result.capabilities.resources);
  });

  it('tools/list 暴露全部 4 个工具(含 list_endpoints / query_data)', async () => {
    const response = await request('tools/list', {});
    const names = response.result.tools.map((tool) => tool.name);
    for (const expected of ['plan_analysis', 'search_knowledge', 'list_endpoints', 'query_data']) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }
  });

  it('resources/list 与 resources/read 可用', async () => {
    const list = await request('resources/list', {});
    assert.ok(list.result.resources.length >= 6);
    const read = await request('resources/read', { uri: 'wm-knowledge://methods/fail-closed' });
    assert.equal(read.result.contents[0].mimeType, 'text/markdown');
    assert.match(read.result.contents[0].text, /Fail-Closed|fail-closed/);
  });

  it('list_endpoints 返回注册表计数', async () => {
    const response = await request('tools/call', { name: 'list_endpoints', arguments: {} });
    const payload = JSON.parse(response.result.content[0].text);
    assert.ok(payload.count >= 50);
  });

  it('query_data 未知端点 → isError 信封(非 JSON-RPC error)', async () => {
    const response = await request('tools/call', { name: 'query_data', arguments: { endpoint: 'no-such' } });
    assert.equal(response.result.isError, true);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, 'unknown_endpoint');
  });

  it('2026-07-28 语义:无握手直接 tools/list 可用', async () => {
    const response = await request('tools/list', {});
    assert.ok(Array.isArray(response.result.tools));
    assert.ok(response.result.tools.length >= 4);
  });

  it('2026-07-28 语义:server/discover 返回能力(无 protocolVersion 字段)', async () => {
    const response = await request('server/discover', {});
    assert.ok(response.result.capabilities.tools);
    assert.ok(response.result.capabilities.resources);
    assert.equal(response.result.serverInfo.name, 'worldmonitor-knowledge-mcp');
    assert.equal(response.result.protocolVersion, undefined, 'discover must not return protocolVersion');
  });

  it('initialize 请求不支持的旧版本时回退到最新 2026-07-28', async () => {
    const response = await request('initialize', { protocolVersion: '2020-01-01', capabilities: {} });
    assert.equal(response.result.protocolVersion, '2026-07-28');
  });
});

describe('Cloudflare Worker(Streamable HTTP)', () => {
  let worker;

  before(async () => {
    // 内联数据已由 scripts/build-data-inline.mjs 生成;worker 顶层 setDataProvider(内联)
    const mod = await import('../worker/index.mjs');
    worker = mod.default;
  });

  async function post(body, env = {}, headers = {}) {
    const request = new Request('https://wm-mcp.example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return worker.fetch(request, env);
  }

  it('POST tools/list 返回 200 与工具清单', async () => {
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.result.tools.some((tool) => tool.name === 'query_data'));
    assert.ok(payload.result.tools.some((tool) => tool.name === 'plan_analysis'));
  });

  it('POST plan_analysis 返回分析计划(内联数据可用)', async () => {
    const response = await post({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'plan_analysis', arguments: { query: '当前中国的大环境对普通人意味着什么？' } },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const plan = JSON.parse(payload.result.content[0].text);
    assert.ok(plan.matched_routes.some((route) => route.id === 'socioeconomic'));
  });

  it('resources/read 读取内联方法论文档', async () => {
    const response = await post({
      jsonrpc: '2.0', id: 3, method: 'resources/read',
      params: { uri: 'wm-knowledge://methods/fail-closed' },
    });
    const payload = await response.json();
    assert.match(payload.result.contents[0].text, /Fail-Closed/);
  });

  it('AUTH_TOKEN 配置时未授权请求返回 401', async () => {
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { AUTH_TOKEN: 'secret123' });
    assert.equal(response.status, 401);
    const authed = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { AUTH_TOKEN: 'secret123' },
      { Authorization: 'Bearer secret123' },
    );
    assert.equal(authed.status, 200);
  });

  it('非 POST 返回 405,非法 JSON 返回 -32700', async () => {
    const get = await worker.fetch(new Request('https://wm-mcp.example.com/mcp'), {});
    assert.equal(get.status, 405);
    const bad = await worker.fetch(new Request('https://wm-mcp.example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }), {});
    const payload = await bad.json();
    assert.equal(payload.error.code, -32700);
  });

  it('通知消息返回 202 空响应', async () => {
    const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    assert.equal(response.status, 202);
  });
});
