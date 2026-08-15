# 数据采集方法论

> 面向 LLM/Agent 的知识:WorldMonitor 如何从真实世界采集、交叉验证、去重与回退。判断"这个数据可信度多高、该不该信"时使用。

## 双源交叉验证原则

单一数据源不是壁垒,也是单点偏见。系统对关键信号刻意使用双源:

- **抗议**: ACLED(30 天窗口,编辑置信度高)+ GDELT(7 天,mention>=5,>=30 标记 validated)
- **自然灾害**: USGS(地震权威)+ GDACS(UN 告警)+ NASA EONET(13 类事件)

**去重**: 0.1° 网格(~10km)+ 同日 Haversine 匹配。冲突时 ACLED 优先(编辑置信度高)。

## 权威源优先原则

- 地震只用 USGS(EONET 地震被排除,质量更低)
- 军事声索与独立观测分离:台湾 MND / 日本统幕发布的是 **publisher claims**,不是 ADS-B/AIS 独立观测;面板明示区别,绝不把来源家族合到一个活动计数里

## 回退链(Fallback)设计

每个关键源有显式降级路径,回退必须是"降级但可判别":

- **CII 冲突**: ACLED → UCDP(滞后年度,可能 2 年窗口无事件,报 COVERAGE_PARTIAL)
- **旅行建议**: live byCountry 等级 → CII 内嵌回退表(有限国家);advisoryProvenance 区分 live/fallback/absent
- **Polymarket 4 层抓取**: bootstrap 水合 → Sebuf RPC → 浏览器直连 → Tauri 原生 TLS
- **OREF 启动**: Redis 历史(>7 天过滤)→ 上游 API 指数退避(3s/6s/12s + jitter)

**原则**: 回退路径必须暴露"用了哪个来源"的元数据,禁止把降级数据伪装成权威数据。

## 反封锁采集技术(经验)

| 场景 | 技术 | 为什么 |
| --- | --- | --- |
| OREF(Akamai WAF) | curl + 住宅代理 + 以色列出口 IP | Node fetch JA3 指纹被阻断 |
| Polymarket(Cloudflare JA3) | 浏览器直连 / Tauri reqwest / edge | 浏览器与 Rust 的 TLS 指纹与 Node 不同 |
| Yahoo Finance | 150ms 错峰批量 | 请求限流 |
| 所有服务端 fetch | 必须带 User-Agent | 上游反爬基线 |

## 数据分级(Severity/Freshness 归一)

- 状态分级: fresh(<15min)/stale(2h)/very_stale(6h)/no_data/error/disabled
- 权威度分级: 见 credibility.md(wire/gov/intel/mainstream/market/tech + tier 1-4 + propaganda risk)

## 判断准则(给 LLM)

1. 一个"事实"至少有三种属性要分开评估: **来源权威度、采集新鲜度、是否被独立源验证**
2. 官方声索 ≠ 独立观测;政府发布(台湾 MND 等)是主张,不是测量
3. 回退数据必须带 provenance 标记;看到 live 与 fallback 混在一起而无标记 = 可疑
4. 采集方法的"合理"(带 LIMIT、有超时、有回退)不等于结果的"正确" —— 分子分母必须同源,见 lessons 索引
