// 共享 MCP JSON-RPC 处理核心:stdio server 与 Cloudflare Worker 复用同一套逻辑。
// 不 import node:* —— 可在本地 Node 与 Workers 运行。
// 入口职责:注入数据提供者(setDataProvider)+ 提供 readResource(读方法论文本)。
import { planAnalysis, searchKnowledge, TOOL_CATALOG as KNOWLEDGE_TOOL_CATALOG } from './knowledge.mjs';
import { listEndpoints, queryEndpoint } from './datasource.mjs';

export const SERVER_NAME = 'worldmonitor-knowledge-mcp';
export const SERVER_VERSION = '0.3.0';
// 最新协议版本 + 旧版回退(2026-07-28 规范:与旧版本互操作时检测对方时代并回退)
export const LATEST_PROTOCOL_VERSION = '2026-07-28';
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'];

// 数据工具定义
const DATA_TOOL_CATALOG = [
  {
    name: 'list_endpoints',
    description:
      '列出 query_data 可调用的 WorldMonitor 数据端点(冲突/军事/市场/网络/灾害/气候/供应链/经济/航空/制裁/贸易等)。' +
      '可选 category 关键词过滤。调用 query_data 前先用它确认端点 id 与参数。',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '按关键词过滤端点,如 "conflict"、"market"、"chokepoint"' },
      },
      required: [],
    },
  },
  {
    name: 'query_data',
    description:
      '执行数据查询:按端点 id 调用 WorldMonitor API(见 list_endpoints 与 wm-knowledge://endpoints)。' +
      '只传该端点注册表声明的参数;响应透传上游 JSON(含 cached_at/stale 新鲜度信封)。' +
      '失败(参数缺失/HTTP 错误/超时/401)返回 isError。查数后请按 plan_analysis 的 verification 规则判断。',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', description: '端点 id,如 get-risk-scores、list-acled-events。先用 list_endpoints 确认。' },
        params: { type: 'object', description: '端点参数(仅注册表声明字段,如 {country_code:"TW"})' },
      },
      required: ['endpoint'],
    },
  },
];

export const TOOL_CATALOG = [...KNOWLEDGE_TOOL_CATALOG, ...DATA_TOOL_CATALOG];

// Resources:方法论与端点目录,模型可直接 resources/read 读取全文
export const RESOURCES = [
  { uri: 'wm-knowledge://methods/caching', name: '缓存与新鲜度方法论', description: '缓存分层、新鲜度语义、The Lever Test(判断数据新鲜度时读)', mimeType: 'text/markdown', file: 'methods/caching.md' },
  { uri: 'wm-knowledge://methods/sourcing', name: '数据采集方法论', description: '双源验证、去重、回退、反封锁采集(评估来源可信度时读)', mimeType: 'text/markdown', file: 'methods/sourcing.md' },
  { uri: 'wm-knowledge://methods/fail-closed', name: 'Fail-Closed 判断原则', description: '缺失=未知=不采信;空泛守卫、变异证明(下结论前必读)', mimeType: 'text/markdown', file: 'methods/fail-closed.md' },
  { uri: 'wm-knowledge://credibility', name: '来源可信度', description: 'SourceType / Tier / PropagandaRisk 分级(评估新闻来源时读)', mimeType: 'text/markdown', file: 'sources/credibility.md' },
  { uri: 'wm-knowledge://cii', name: 'CII 风险指数方法论', description: 'CII 四组件与公式(v8)(解读风险分数时读)', mimeType: 'text/markdown', file: 'signals/cii.md' },
  { uri: 'wm-knowledge://endpoints', name: '数据端点目录', description: 'query_data 可用端点全清单(含参数与路径)', mimeType: 'application/json', file: 'endpoints.json' },
];

/**
 * 创建 JSON-RPC 消息处理器。
 * @param {object} opts
 * @param {string} opts.apiBase  数据查询 API 基址(如 https://worldmonitor.app)
 * @param {string} opts.apiKey   Pro 端点密钥(可为空)
 * @param {(file: string) => string} opts.readResource  按 data/ 相对路径返回文本(resources/read 用)
 * @returns {(message: object) => { response: object | null }} 处理器;通知类返回 { response: null }
 */
export function createMcpHandler({ apiBase, apiKey, readResource }) {
  const capabilities = { tools: {}, resources: {} };
  const serverInfo = { name: SERVER_NAME, version: SERVER_VERSION };

  function rpcError(id, code, message) {
    return { response: { jsonrpc: '2.0', id, error: { code, message } } };
  }

  function toolResult(id, text, isError = false) {
    const result = { content: [{ type: 'text', text: JSON.stringify(text, null, 2) }] };
    if (isError) result.isError = true;
    return { response: { jsonrpc: '2.0', id, result } };
  }

  function handleToolsCall(id, name, args) {
    switch (name) {
      case 'plan_analysis':
        return toolResult(id, planAnalysis(args?.query ?? '', {
          countries: args?.countries,
          maxRoutes: args?.max_routes,
        }));
      case 'search_knowledge':
        return toolResult(id, searchKnowledge(args?.query ?? '', {
          category: args?.category,
          limit: args?.limit,
        }));
      case 'list_endpoints': {
        const endpoints = listEndpoints(args?.category);
        return toolResult(id, { count: endpoints.length, endpoints });
      }
      case 'query_data':
        return handleQueryData(id, args);
      default:
        return rpcError(id, -32602, `Unknown tool: ${name}`);
    }
  }

  async function handleQueryData(id, args) {
    const endpoint = typeof args?.endpoint === 'string' ? args.endpoint : '';
    if (!endpoint) {
      return toolResult(id, { endpoint: '', ok: false, error: 'endpoint is required — call list_endpoints first' }, true);
    }
    const params = args?.params && typeof args.params === 'object' && !Array.isArray(args.params) ? args.params : {};
    const result = await queryEndpoint(endpoint, params, { baseUrl: apiBase, apiKey });
    return toolResult(id, { endpoint, ...result }, result.ok === false);
  }

  /**
   * 处理一条 JSON-RPC 消息(请求或通知),返回要发给客户端的响应(通知为 null)。
   * 注意:tools/call(query_data)为异步,可能返回 Promise<{response}> —— 传输层需 await。
   */
  return function handleMessage(message) {
    const { id, method, params } = message ?? {};
    if (message?.jsonrpc !== '2.0' || typeof method !== 'string') return { response: null };

    switch (method) {
      case 'initialize': {
        // 旧版客户端(基于 initialize 握手):回响其请求的版本(不支持则用最新)
        const requested = params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
        return { response: { jsonrpc: '2.0', id, result: { protocolVersion, capabilities, serverInfo } } };
      }
      case 'server/discover':
        // 2026-07-28 新语义:无握手,客户端通过 discover 获取能力
        return { response: { jsonrpc: '2.0', id, result: { capabilities, serverInfo } } };
      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'notifications/roots/list_changed':
        return { response: null };
      case 'ping':
        return { response: { jsonrpc: '2.0', id, result: {} } };
      case 'tools/list':
        return { response: { jsonrpc: '2.0', id, result: { tools: TOOL_CATALOG } } };
      case 'tools/call':
        return handleToolsCall(id, params?.name, params?.arguments);
      case 'resources/list':
        return {
          response: {
            jsonrpc: '2.0',
            id,
            result: { resources: RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })) },
          },
        };
      case 'resources/read': {
        const uri = params?.uri;
        const resource = typeof uri === 'string' ? RESOURCES.find((entry) => entry.uri === uri) : null;
        if (!resource) return rpcError(id, -32602, `Unknown resource URI: ${uri}`);
        let text;
        try {
          text = readResource(resource.file);
        } catch (error) {
          return rpcError(id, -32603, `Resource unreadable: ${error?.message ?? error}`);
        }
        return {
          response: {
            jsonrpc: '2.0',
            id,
            result: { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }] },
          },
        };
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  };
}
