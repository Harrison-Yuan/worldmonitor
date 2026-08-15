# Fail-Closed 判断原则

> 面向 LLM/Agent 的核心行为准则。WorldMonitor 的默认值是"缺失 = 未知 = 不采信",而不是"缺失 = 零/正常/无"。违反 fail-closed 的静默成功比失败更危险。

## 核心原则

**缺失信息必须显示为缺失,不能显示为"正常值"。**

- `0`、`null`、`[]`、`false` 都是"看似合理"的答案 —— 合理正是陷阱:一个 fail-open 的默认值被洗成了真答案
- 未知来源默认不是独立媒体:`UNREVIEWED_SOURCE_RISK = { risk: 'unknown', note: 'Provenance not yet reviewed — do not treat as independent journalism' }`
- 未审核 = 未知,禁止推断独立;宣传风险徽章:unknown 永远浮出水面,静默从不暗示独立

## 各层级的 fail-closed 语义

### 来源可信度
- SourceType 8 类: wire / gov / intel / mainstream / market / tech / other / unknown
- Tier 4 级: 1=wire/gov 最快最权威 → 4=聚合器/博客
- PropagandaRisk 4 级: low(必须显式声明,从不默认)/ medium / high(国家附属)/ unknown
- 缺失的 provenance 不回退成 low —— 只回退成 unknown

### 事件归属(Country Scope)
- 警报规则的未限定国家范围 = 所有事件合格;限定 = opt-in 收窄
- **未归属事件默认丢弃**(除非在显式允许名单:breaking-news 源,其发布者尚无法可靠归属)
- 归属是发布者的职责:发布者知道国家就必须挂上 —— 缺失归属在下游与"全球事件"不可区分,名称归一化失败会把"查找失败"变成"字段不存在",让作用域投递泄漏

### 校验与守卫(guard)
- **Vacuous Guard(空泛守卫)**: 测试/CI/审计报告"成功"却没有检查声称覆盖的东西,因为输入悄悄缩小了。断言负(列表为空、计数为零)时,空输入完美满足 —— 检查得越少,看起来越绿。比没有守卫更糟,因为它还提供信心
- **Mutation Proof(变异证明)**: 故意破坏守卫保护的东西 → 观察守卫变红 → 字节级还原。只读守卫确立意图,只有变异确立覆盖

### 数据就绪度
- China macro seed: 校验只查槽位数 >=4 验证的是形状不是就绪度 —— 就绪判定必须用 adapter 的 launchReady===true 且 status===ready(见 lessons 索引)
- 缺失/过期/部分源显示为 unavailable/degraded,绝不显示为零值

## 判断准则(给 LLM)

1. 看到默认值(`0`/`[]`/`null`/空列表)时,先问:这是真实答案,还是 fail-open 的洗白?
2. "X 不存在"的断言,在 X 不可能产生的输入下永远通过 —— 检查输入是否可能产出 X
3. 唯一性 ≠ 同一性:一个标签恰好匹配一个实体,回答的是注册表内容问题,不是调用者意图问题;低精度键仅在注册表自身有确认字段时才可用,缺证据就 fail-closed 拒绝
4. 修复一个"受害者"(被推走的元素)之前,先找"施动者"(谁改变了自身足迹) —— 归因 API 只报受害者,不报原因
5. 派生统计的分子分母必须同源:一个来自 LIMIT 抓取、一个来自常量 = bug(见 lessons 索引 keyword-spike 案例)
