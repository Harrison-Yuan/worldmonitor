#!/usr/bin/env node
// WorldMonitor 懂行知识 MCP server —— stdio 传输层(本地)。
// 协议:JSON-RPC 2.0 over stdio(newline-delimited)。处理逻辑全部在 lib/mcp-handler.mjs,
// 与 Cloudflare Worker 复用同一套实现。零运行时依赖,node >= 18。
// 环境变量:WM_API_BASE(默认 https://worldmonitor.app)、WM_API_KEY(Pro 端点可选)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setDataProvider, readDataText } from './lib/data-access.mjs';
import { createMcpHandler, SERVER_NAME, SERVER_VERSION, LATEST_PROTOCOL_VERSION } from './lib/mcp-handler.mjs';
import { loadEndpoints } from './lib/datasource.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

// 数据提供者:本地从 data/ 目录读文件
setDataProvider((rel) => readFileSync(join(ROOT, 'data', rel), 'utf8'));

const API_BASE = process.env.WM_API_BASE || loadEndpoints().baseUrl;
const API_KEY = process.env.WM_API_KEY || '';

const handleMessage = createMcpHandler({
  apiBase: API_BASE,
  apiKey: API_KEY,
  readResource: (file) => readDataText(file),
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(...parts) {
  process.stderr.write(`${parts.join(' ')}\n`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    try {
      const outcome = handleMessage(JSON.parse(line));
      if (outcome && typeof outcome.then === 'function') {
        // 异步工具(query_data)的响应是 Promise
        outcome.then(({ response }) => {
          if (response) send(response);
        }).catch((error) => {
          log('handler async error:', error?.stack ?? String(error));
        });
      } else if (outcome?.response) {
        send(outcome.response);
      }
    } catch (error) {
      log('malformed JSON-RPC line, ignored:', error.message);
    }
  }
});
process.stdin.on('end', () => {
  process.exit(0);
});

log(`${SERVER_NAME} v${SERVER_VERSION} ready (stdio MCP, protocol ${LATEST_PROTOCOL_VERSION} + legacy fallback, api ${API_BASE})`);
