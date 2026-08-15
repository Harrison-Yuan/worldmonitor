#!/usr/bin/env node
// 生成 lib/data-inline.mjs:把 data/ 下运行时需要的文件内联为 JS 模块。
// Cloudflare Workers 无文件系统,数据必须随 bundle 一起部署。
// 用法:node scripts/build-data-inline.mjs(在 knowledge-mcp 目录内运行)
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'lib');
const OUT_FILE = join(OUT_DIR, 'data-inline.mjs');
// 不需要内联的目录(纯 schema 契约,运行时用不到)
const SKIP_DIRS = new Set(['schema']);

function collectFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      collectFiles(full, acc);
    } else if (entry.endsWith('.json') || entry.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collectFiles(DATA_DIR).sort();
const entries = files.map((full) => {
  const rel = relative(DATA_DIR, full).split(sep).join('/');
  const text = readFileSync(full, 'utf8');
  // JSON 内联为对象(保留数据结构);文本内联为字符串(JSON.stringify 保证转义安全)
  const value = rel.endsWith('.json') ? JSON.parse(text) : text;
  return { rel, serialized: JSON.stringify(value) };
});

const banner = `// GENERATED FILE — 由 scripts/build-data-inline.mjs 生成,勿手改。
// 数据已内联以便 Cloudflare Workers 部署(无文件系统)。改 data/ 后重新生成。
export const WM_DATA = Object.freeze({`;
const body = entries.map(({ rel, serialized }) => `  ${JSON.stringify(rel)}: ${serialized},`).join('\n');
const footer = `});`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, `${banner}\n${body}\n${footer}\n`, 'utf8');
console.log(`OK: ${entries.length} files inlined -> ${relative(ROOT, OUT_FILE)}`);
