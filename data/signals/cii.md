# CII 国家风险指数(Composite Instability Index)方法论

> 面向 LLM/Agent 的知识:WorldMonitor 的 CII 如何把多源信号加权成国家不稳定度。用于理解"一个国家的分数由什么构成、为什么高/低"。权威全文见 docs/methodology/cii-risk-scores.mdx,当前 methodology_version = v8。

## 性质声明(重要)

CII 权重是**编辑性判断**(WorldMonitor 情报团队内部评审),**不是**来自公开发表的学术指数或第三方风险产品。分数是"观点",不是"实证"。`CiiScore.methodology_version` 标记计算所用的方法论修订版。

## 四组件(0-100 子分)

| 组件 | 编辑含义 |
| --- | --- |
| **U**nrest(`cii_contribution`) | 公民骚乱压力:ACLED 抗议+骚乱、死亡、确认的断网/断电、高严重度骚乱提升。反映暴力前摩擦 |
| **C**onflict(`geo_convergence`) | 动能活动:ACLED 战斗、爆炸/远程暴力、针对平民暴力,加伊朗地区打击强度与以色列 OREF 警报压力。事件活动 log 缩放后加组件上限;平方根死亡缩放防单事件饱和 |
| **S**ecurity(`military_activity`) | 硬安全节奏:军机活动、军舰活动、航空中断(关闭/延误)、GPS 干扰 hex 密度。外国军事存在权重 ×2 |
| **I**nformation(`news_activity`) | 信息环境压力:归因到该国的 critical/high/medium 分类头条的加权计数 |

## combinedScore 公式

```
eventScore = U * 0.25 + C * 0.30 + S * 0.20 + I * 0.25

composite = baseline * 0.4
          + eventScore * 0.6
          + climateBoost      (≤ 15)
          + cyberBoost        (≤ 12, severity-weighted)
          + fireBoost         (≤  8, high-fire weighted)
          + advisoryBoost     (≤ 15)
          + orefBlendBoost    (IL only, ≤ 25)
          + displacementBoost (≤ 20)
          + newsUrgencyBoost  (≤  5)
          + earthquakeBoost   (≤ 25)
          + sanctionsBoost    (≤ 14)
          + aisBoost          (≤ 10, AIS disruptions)
```

`composite` 被夹到 `[floor, 100]`,floor 取两者较大:

- **UCDP floor**: 活跃战争级事件 = 70;轻微冲突级 = 50
  - 分类(2 年滚动窗口):战争 = 总死亡 >1000 或事件数 >100;轻微 = 事件数 >10
  - UCDP 现实约束:writer 最多保留 365 天切片 2000 事件,故实况评分受 seed 输入边界限制
- **State Department 建议 floor**: do-not-travel = 60;reconsider travel = 50

## 易错细节

- **Unrest 提升**: 高严重度 ACLED 骚乱(如 riot)加 `min(20, highSeverityUnrest * 10 * eventMultiplier)`
- **平民暴力**: 加 `min(10, civilianViolence * 3)`(在 log 缩放冲突活动与死亡项之后)
- **伊朗打击**: `min(50, iranStrikes * 3 + highSeverityStrikes * 5)`;高/致命严重度打击计两次(per-strike 项 + 高严重度项)。此 feed 是战区强度输入,非完整武装冲突伤亡源;ACLED/UCDP 仍是常规冲突锚
- **OREF(仅以色列)**: 组件内加 `25 + min(25, activeAlertCount * 5)`(上限 +50);另复合层 orefBlendBoost(≤25)
- **信息严重度权重**: critical=4, high=2, medium/elevated=1, moderate/low=0.5, info=0;威胁摘要子分上限 20,信息组件上限 100
- **建议来源优先级**: live `intelligence:advisories:v1` byCountry → 内嵌 State Dept 回退表;`advisoryProvenance` = live/fallback/absent

## baselineRisk 与 eventMultiplier

- 逐国编辑参数(shared/cii-weights.ts 为单一事实源,server 与前端共用)
- **baselineRisk**: "常开"不稳定度。baseline=5(US/DE/GB/JP)需要响亮的事件信号才出高分;baseline=50 的国家天生高
- **eventMultiplier**: 事件报道偏差校正。抑制报道过度国家(0.3-0.6),放大报道不足/压制国家(2.0-3.0);骚乱计数用 `log2(n+1) * multiplier * 5` 而非线性
- **归因警示**: 文本归因拒绝裸 `korean`(歧义),接受 `north korean`/`taiwanese`;坐标归因是矩形近似,非完整 point-in-polygon;三方 bbox 重叠先于两两边界规则

## dynamicScore(趋势)

- `-100..100` 有符号移动增量,对比约 24 小时前的有效 CII 快照
- 趋势标签严格单点死区:整点变化 ±1 仍稳定,±2 才首次标记 rising/falling

## 判断准则(给 LLM)

1. CII 分数是编辑观点,引用时需带 methodology_version,不当作客观事实
2. 低 baseline 国家的高分比高 baseline 国家的同等分更"响亮"
3. 归因(国家文本/坐标)本身有误差,高价值重叠区(US/MX 边境、DMZ、RU/UA、IN/PK)做过定向校准
4. health 覆盖:冲突族由 ACLED **或** UCDP 满足,ACLED 空窗不再单独翻 COVERAGE_PARTIAL(UCDP 健康时)
