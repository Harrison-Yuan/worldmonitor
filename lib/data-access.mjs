// 数据访问抽象:数据提供者注入机制。
// 本地(stdio server / 测试):由入口调用 setDataProvider 注入 readFileSync 实现。
// Cloudflare Worker:由 worker/index.mjs 注入内联数据实现(构建脚本生成)。
// lib 其余模块不 import node:* —— 保证同一套逻辑可在 Workers(无文件系统)运行。
let provider = null;

/**
 * @param {(rel: string) => string} fn 传入相对 data/ 的路径,返回文件文本内容。
 */
export function setDataProvider(fn) {
  provider = fn;
}

export function isDataProviderSet() {
  return provider !== null;
}

/** 读取 data/ 下文件的文本内容(相对路径,如 'routing/analysis-routes.json')。 */
export function readDataFile(rel) {
  if (!provider) {
    throw new Error('data provider not set — call setDataProvider() from the entry point (server.mjs or worker/index.mjs)');
  }
  return provider(rel);
}

/** 读取并解析 data/ 下 JSON 文件。提供者返回字符串(本地)或对象(内联)皆可。 */
export function readDataJson(rel) {
  const raw = readDataFile(rel);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/** 读取 data/ 下文本文件(如 methods/*.md)。 */
export function readDataText(rel) {
  return readDataFile(rel);
}
