#!/usr/bin/env node
// 一键部署到 Cloudflare Workers。
// 用法:npm run deploy 或 node scripts/deploy.mjs [--dry-run]
// 自动完成:生成内联数据 → 检查 wrangler → 部署 → 输出 URL → 提示配置 secrets。
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');

function run(cmd, { quiet = false } = {}) {
  console.log(`\n> ${cmd}`);
  if (DRY_RUN) {
    console.log('  [dry-run] 跳过执行');
    return { stdout: '' };
  }
  return execSync(cmd, { cwd: ROOT, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

console.log('=== WorldMonitor 懂行知识 MCP 一键部署 ===');

// 1. 生成内联数据(Workers 无文件系统)
console.log('\n[1/4] 生成内联数据(lib/data-inline.mjs)');
run('node scripts/build-data-inline.mjs');
if (!existsSync(join(ROOT, 'lib', 'data-inline.mjs'))) fail('内联数据生成失败');

// 2. 检查 wrangler
console.log('\n[2/4] 检查 wrangler');
let wranglerVersion = '';
try {
  wranglerVersion = execSync('npx --no-install wrangler --version', {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  console.log(`  已就绪:${wranglerVersion}`);
} catch {
  console.log('  本机未装 wrangler,将按需下载(npx wrangler)');
}

// 3. 部署
console.log('\n[3/4] 部署到 Cloudflare Workers');
let output;
try {
  output = run('npx wrangler deploy');
} catch (error) {
  const stderr = String(error?.stderr ?? error?.message ?? '');
  if (/login|authentication|token/i.test(stderr)) {
    fail('wrangler 未登录/无令牌。请先运行 `npx wrangler login`,或设置 CLOUDFLARE_API_TOKEN 环境变量后重试。');
  }
  fail(`部署失败:${stderr.slice(0, 500) || error.message}`);
}

const stdout = String(output?.stdout ?? '');
const url = stdout.match(/https:\/\/[a-z0-9-]+\.workers\.dev(?:\/[^\s]*)?/i)?.[0] ?? '';

// 4. 部署后提示
console.log('\n[4/4] 部署完成');
if (url) console.log(`  URL: ${url}`);
console.log(`
  下一步(生产必做):
    1. 设置访问令牌:npx wrangler secret put AUTH_TOKEN
    2. (可选)设置 Pro 密钥:npx wrangler secret put WM_API_KEY
    3. 客户端接入:
       { "mcpServers": { "wm-knowledge": {
           "type": "http",
           "url": "${url || '<deployed-url>/mcp'}",
           "headers": { "Authorization": "Bearer <AUTH_TOKEN>" }
       } } }
`);

if (DRY_RUN) console.log('(dry-run 完成,未实际部署)');
