// 懂行知识核心逻辑:分析规划 + 知识检索。
// 纯函数、可移植:不 import node:* —— 同一套逻辑可在本地 Node 与 Cloudflare Workers 运行。
// 数据来源由入口注入(见 data-access.mjs)。
import { readDataJson } from './data-access.mjs';
import { loadEndpoints } from './datasource.mjs';

export function loadKnowledge() {
  const routes = readDataJson('routing/analysis-routes.json');
  const sourcesRegistry = readDataJson('sources/registry.json');
  const signalsRegistry = readDataJson('signals/registry.json');
  const lessonsIndex = readDataJson('lessons/index.json');

  const sourcesById = new Map(
    sourcesRegistry.domains.flatMap((domain) => domain.sources).map((source) => [source.id, source]),
  );
  const signalsById = new Map(
    signalsRegistry.signals.map((signal) => [signal.id, signal]),
  );
  return { routes: routes.routes, sourcesById, signalsById, lessons: lessonsIndex.lessons };
}

function pickSourceSummary(source) {
  if (!source) return null;
  const { id, name, domain, data_type, freshness } = source;
  return { id, name, domain, data_type, freshness };
}

function pickSignalSummary(signal) {
  if (!signal) return null;
  return {
    id: signal.id,
    name: signal.name,
    thresholds: signal.thresholds.map(({ level, condition }) => ({ level, condition })),
  };
}

/**
 * 分析规划:根据提问决定 查什么 / 从哪查 / 怎么验证 / 输出什么。
 * 确定性路由(无 LLM 调用):关键词匹配 analysis-routes,命中不足时回退国家综合风险。
 */
export function planAnalysis(query, { countries = [], maxRoutes = 3 } = {}) {
  const { routes, sourcesById, signalsById } = loadKnowledge();
  const normalized = String(query ?? '').trim().slice(0, 500);
  if (normalized.length < 2) {
    return { query: normalized, matched_routes: [], countries, fallback_used: false };
  }
  const lower = normalized.toLowerCase();
  const cap = Math.max(1, Math.min(5, Number(maxRoutes) || 3));

  const scored = routes
    .map((route) => ({ route, hits: route.keywords.filter((kw) => lower.includes(kw.toLowerCase())) }))
    .filter((candidate) => candidate.hits.length > 0)
    .sort((a, b) => {
      if (b.hits.length !== a.hits.length) return b.hits.length - a.hits.length;
      const lenA = a.hits.reduce((sum, hit) => sum + hit.length, 0);
      const lenB = b.hits.reduce((sum, hit) => sum + hit.length, 0);
      return lenB - lenA;
    });

  const buildRoute = (route, hits) => {
    const { byId } = loadEndpoints();
    return {
      id: route.id,
      name: route.name,
      matched_keywords: hits,
      information_needs: route.information_needs,
      sources: route.sources.map((id) => pickSourceSummary(sourcesById.get(id))).filter(Boolean),
      signals: route.signals.map((id) => pickSignalSummary(signalsById.get(id))).filter(Boolean),
      verification: route.verification,
      caveats: route.caveats,
      recommended_tools: route.recommended_tools,
      endpoints: (route.endpoints ?? [])
        .map((id) => {
          const endpoint = byId.get(id);
          return endpoint ? { id: endpoint.id, method: endpoint.method, path: endpoint.path, summary: endpoint.summary } : null;
        })
        .filter(Boolean),
      output_framework: route.output_framework,
    };
  };

  const selected = scored.slice(0, cap).map(({ route, hits }) => buildRoute(route, hits));
  if (selected.length > 0) {
    return { query: normalized, matched_routes: selected, countries, fallback_used: false };
  }

  const fallback = routes.find((route) => route.id === 'country_risk');
  if (fallback) {
    return {
      query: normalized,
      matched_routes: [buildRoute(fallback, [])],
      countries,
      fallback_used: true,
    };
  }
  return { query: normalized, matched_routes: [], countries, fallback_used: false };
}

const KNOWLEDGE_CATEGORIES = ['sources', 'signals', 'lessons', 'methods'];

/**
 * 知识检索:在数据源/信号/负知识/方法论中按关键词找命中,让模型先看"前人经验"再动手。
 * 查询按中英文词切分,命中任一词即算(OR),按命中词数排序。
 */
export function searchKnowledge(query, { category = 'all', limit = 10 } = {}) {
  const { sourcesById, signalsById, lessons } = loadKnowledge();
  const raw = String(query ?? '').trim();
  if (!raw) return { query: '', hits: [] };
  // 中英文词切分:空格/标点分隔,同时保留整体短语参与匹配
  const terms = [...new Set(
    raw
      .split(/[\s,，。；;、/]+/)
      .map((term) => term.toLowerCase())
      .filter((term) => term.length > 0),
  )];
  const cap = Math.max(1, Math.min(25, Number(limit) || 10));
  const scored = [];
  const want = (name) => category === 'all' || category === name;

  const push = (hit, haystack) => {
    const lower = haystack.toLowerCase();
    const matched = terms.filter((term) => lower.includes(term));
    if (matched.length > 0) scored.push({ score: matched.length, matched, hit });
  };

  if (want('sources')) {
    for (const source of sourcesById.values()) {
      push(
        {
          category: 'source',
          id: source.id,
          name: source.name,
          snippet: source.description ?? '',
          caveats: (source.caveats ?? []).slice(0, 3),
        },
        [source.id, source.name, source.domain, source.description ?? '', ...(source.caveats ?? [])].join(' '),
      );
    }
  }

  if (want('signals')) {
    for (const signal of signalsById.values()) {
      push(
        {
          category: 'signal',
          id: signal.id,
          name: signal.name,
          snippet: signal.description ?? '',
          thresholds: signal.thresholds.slice(0, 5).map(({ level, condition }) => ({ level, condition })),
        },
        [signal.id, signal.type, signal.name, signal.description ?? ''].join(' '),
      );
    }
  }

  if (want('lessons')) {
    for (const lesson of lessons) {
      push(
        {
          category: 'lesson',
          title: lesson.title,
          severity: lesson.severity,
          lesson: lesson.lesson,
          apply_when: lesson.apply_when,
          source: lesson.source,
        },
        [lesson.title, lesson.module ?? '', ...(lesson.tags ?? [])].join(' '),
      );
    }
  }

  if (want('methods')) {
    const methods = [
      { id: 'caching', title: '缓存与新鲜度方法论', file: 'methods/caching.md', topics: ['缓存分层', '新鲜度', 'stampede', 'seed-owned', 'bootstrap tier', 'lever test', 'cache'] },
      { id: 'sourcing', title: '数据采集方法论', file: 'methods/sourcing.md', topics: ['双源验证', '去重', '回退', '反封锁', '权威源优先', 'source', 'fallback'] },
      { id: 'fail-closed', title: 'Fail-Closed 判断原则', file: 'methods/fail-closed.md', topics: ['fail-closed', 'vacuous guard', 'mutation proof', '未归属', '默认', '缺失', 'zero'] },
    ];
    for (const method of methods) {
      push(
        { category: 'method', id: method.id, title: method.title, file: method.file },
        [method.title, ...method.topics].join(' '),
      );
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return { query: raw, hits: scored.slice(0, cap).map((entry) => ({ ...entry.hit, matched: entry.matched })) };
}

export const TOOL_CATALOG = [
  {
    name: 'plan_analysis',
    description:
      '分析规划(懂行路由):给定提问,返回"查什么信息 / 从哪查 / 怎么验证 / 输出什么"的分析计划。' +
      '确定性路由,不调 LLM。命中不足时回退国家综合风险。用法:先调本工具得到计划,再按 recommended_tools 与 verification 拉数据、验证、输出。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要规划分析的问题,如"台湾海峡局势是否升级,对芯片供应链意味着什么?"' },
        countries: { type: 'array', items: { type: 'string' }, description: '可选 ISO-2 国家代码聚焦,如 ["TW","CN"]' },
        max_routes: { type: 'integer', minimum: 1, maximum: 5, description: '最多返回几个命中主题(默认 3)' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        matched_routes: { type: 'array', items: { type: 'object' } },
        countries: { type: 'array', items: { type: 'string' } },
        fallback_used: { type: 'boolean' },
      },
    },
  },
  {
    name: 'search_knowledge',
    description:
      '检索懂行知识库:数据源、信号/阈值、负知识(踩坑教训)、方法论。' +
      '做判断前先搜对应领域的坑与规则,再行动;负知识命中给出"什么会静默出错、正确做法"。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词,如"fail-closed"、"ACLED"、"去重"' },
        category: { type: 'string', enum: ['all', 'sources', 'signals', 'lessons', 'methods'], description: '限定检索类别(默认 all)' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: '最多返回命中数(默认 10)' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        hits: { type: 'array', items: { type: 'object' } },
      },
    },
  },
];
