# 缓存与新鲜度方法论

> 面向 LLM/Agent 的知识:WorldMonitor 的缓存分层、新鲜度语义与成本模型。判断"这个数是否可信、有多新鲜"时使用。

## 缓存分层(Cache Tiers)

| Tier | TTL | 用途 |
| --- | --- | --- |
| fast | 5m | 首屏必需,立即投递 |
| medium | 10m | 常规面板数据 |
| slow | 30m | 低频变更数据 |
| static | 2h | 近静态数据 |
| daily | 24h | 日更数据 |

缓存键必须包含请求相关参数,否则不同请求互相污染。

## Bootstrap Tier 语义

bootstrap 键分三类,决定"何时"投递给客户端:

- **fast**: 首屏必需,立即投递
- **slow**: 启动后不久需要,第二批投递
- **on-demand**: 面板/图层真正请求时才按需获取(走 CDN 可缓存 URL,不能回落到直连数据库读 —— 那只是搬移成本)

关键原则:**缓存我们展示的,而不是缓存源头**(Bootstrap View Key 与 canonical key 分离)。View key 只装 UI 实际渲染的切片;canonical key 保留全量供 RPC/MCP/分析消费。

## Seed-Owned Key 语义

- 键的唯一写入方是专用 seeder/relay;edge 端点只读不写
- 读 miss 时返回短 TTL 计算回退,等 seeder 下个周期恢复
- 后果:reader 便宜且不会用降级载荷污染键;但 purge 不会强制读时再生成 —— 新鲜度恢复只按 owner 的调度,过期 owner 仍在跑时 purge 会被旧数据覆盖

## One-Shot Hydration

- 水合值只可读一次,读即消耗
- **任何周期性读取者(刷新 tick、重试)保证 miss,落到回退路径** —— 当回退不受 CDN 屏蔽时,一次性水合 + 刷新定时器会静默制造 origin 流量。审计每个刷新路径的回退。

## The Lever Test(成本启发式)

```
egress ≈ origin-miss 数 × 每次传输的载荷大小
```

- 客户端数、读取者数、总请求量都被 CDN 吸收,不进公式
- 优化只有降低 miss 率或每 miss 字节数才算数;净零的算术(去重存储但两条读路径都活着、翻一个从不碰服务载荷的客户端默认值)直接否决

## 负缓存与失败语义(redis.ts)

- 抓取错误负缓存 TTL 30s(fetch error 时禁止缓存权威否定)
- Redis 失败正向回退 TTL 30s(clamped,防陈旧数据久留)
- `cachedFetchJson()` 合并并发 miss(stampede 保护);inflight 条目强制超时落定(#3539),防真挂起的 fetch 永久占用
- 本地负冷却 + 本地不可用退避,防打爆上游

## 新鲜度跟踪(freshness tracker)

35 个源按状态分级:**fresh(<15min) / stale(2h) / very_stale(6h) / no_data / error / disabled**。

- 显式报告 **intelligence gaps** —— 分析师看不见什么 —— 防止关键源挂掉时产生虚假信心
- GDELT 与 RSS 标记 `requiredForRisk`,驱动 Strategic Risk 面板的硬性数据不足门(非 CII 输入清单)
- 评分相关源(UCDP events、ACLED conflict、news summaries、cyber threats)通过源专属健康 + `riskScores` 信号密度覆盖跟踪

## 判断准则(给 LLM)

1. 一个缓存值的新鲜度 = 其 tier 的 TTL,不是"看起来新"
2. seed-owned 键缺失 ≠ 读时能再生成;purge 后恢复依赖 owner 调度
3. 负缓存(错误)与正向回退(Redis 故障)都只有 30s —— 若看到长时间不变的"错误",是配置/逻辑问题
4. 任何"重申常量"的响应字段(如 baseline_hours)必须由实际返回的行计算,不能是硬编码 —— 见 lessons 索引中 keyword-spike 案例
