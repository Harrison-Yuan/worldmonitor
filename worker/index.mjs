// WorldMonitor 懂行知识 MCP —— Cloudflare Worker 入口(Streamable HTTP 传输)。
// 与 stdio server 复用同一套处理逻辑(lib/mcp-handler.mjs)。
// 数据由 scripts/build-data-inline.mjs 生成的 lib/data-inline.mjs 内联(Workers 无文件系统)。
//
// 环境变量(wrangler vars / secrets):
//   WM_API_BASE     数据查询 API 基址(默认 https://worldmonitor.app)
//   WM_API_KEY      WorldMonitor Pro 密钥(可选,query_data 出站用)
//   AUTH_TOKEN      可选:外部访问令牌(Authorization: Bearer <token> 或 X-API-Token)
//   ALLOWED_ORIGINS 可选:Origin 白名单(逗号分隔),防 DNS rebinding;留空则不校验
import { setDataProvider } from '../lib/data-access.mjs';
import { createMcpHandler } from '../lib/mcp-handler.mjs';
import { WM_DATA } from '../lib/data-inline.mjs';

// 数据提供者:全部数据已内联打包
setDataProvider((rel) => {
  if (!(rel in WM_DATA)) throw new Error(`data file not bundled: ${rel} — rerun scripts/build-data-inline.mjs`);
  return WM_DATA[rel];
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Token, MCP-Protocol-Version, Accept',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
    },
  });
}

function unauthorized() {
  return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized — set AUTH_TOKEN on the server' } }, 401);
}

export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Token, MCP-Protocol-Version, Accept', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
    }

    // 可选鉴权
    if (env.AUTH_TOKEN) {
      const bearer = request.headers.get('Authorization') ?? '';
      const apiToken = request.headers.get('X-API-Token') ?? '';
      if (bearer !== `Bearer ${env.AUTH_TOKEN}` && apiToken !== env.AUTH_TOKEN) {
        return unauthorized();
      }
    }

    // Origin 白名单(防 DNS rebinding;仅当配置了白名单且请求带 Origin 时校验)
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
    if (origin && allowed.length > 0 && !allowed.includes(origin)) {
      return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'origin not allowed' } }, 403);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'only POST is supported' } }, 405);
    }

    let message;
    try {
      message = await request.json();
    } catch {
      return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error: body must be a JSON-RPC message' } }, 400);
    }

    // 每次请求构建 handler(绑定当前 env 的 API 配置)
    const handler = createMcpHandler({
      apiBase: env.WM_API_BASE || 'https://worldmonitor.app',
      apiKey: env.WM_API_KEY || '',
      readResource: (file) => {
        if (!(file in WM_DATA)) throw new Error(`resource not bundled: ${file}`);
        return WM_DATA[file];
      },
    });

    const outcome = handler(message);
    if (outcome && typeof outcome.then === 'function') {
      // 异步工具(query_data)的响应是 Promise
      const { response } = await outcome;
      if (response === null) {
        return new Response(null, { status: 202, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      return jsonResponse(response);
    }
    if (outcome.response === null) {
      // 通知类消息:202 Accepted,空 body(Streamable HTTP 约定)
      return new Response(null, { status: 202, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return jsonResponse(outcome.response);
  },
};
