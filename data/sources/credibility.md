# 来源可信度与分级

> 面向 LLM/Agent 的知识:如何评估一个新闻/数据来源的权威度与偏见风险。权威注册表在 shared/source-provenance.ts 与 shared/source-tiers.json。

## SourceType(来源类型,8 类)

| 类型 | 含义 | 例子 |
| --- | --- | --- |
| `wire` | 通讯社,最快最权威 | Reuters、AP、AFP、Bloomberg、Xinhua、TASS、RT(类型上仍是 wire,风险上另有分级) |
| `gov` | 政府与国际组织官方 | White House、Pentagon、Federal Reserve、UN News、中国部委(PBoC、MOFCOM...) |
| `intel` | 专业/情报类 | Defense One、The War Zone、Janes、Bellingcat、CSIS、RAND、OCCRP、DFRLab |
| `mainstream` | 主流媒体 | BBC、Guardian、CNN、Politico、Al Jazeera、France 24 |
| `market` | 市场/财经 | CNBC、Yahoo Finance、Financial Times、Nikkei Asia |
| `tech` | 科技 | Hacker News、The Verge、MIT Tech Review |
| `other` | 显式其他 | — |
| `unknown` | 未审核(默认,永不发明) | 未列出的任何源 |

## Source Tier(权威度 1-4)

| Tier | 描述 | 例子 |
| --- | --- | --- |
| 1 | 通讯社、官方政府/国际组织 | Reuters、AP、BBC、DOD |
| 2 | 主流成熟媒体 | CNN、NYT、The Guardian、Al Jazeera |
| 3 | 专业/区域/智库 | Defense One、Breaking Defense、The War Zone |
| 4 | 聚合器与博客 | Google News、个人分析师博客 |

未列出源默认 tier 4。威胁分类置信度按 tier 加权 —— tier 1 突发告警权重大于 tier 4 博客。

## PropagandaRisk(宣传风险,4 级)

| 风险 | 含义 | 例子 |
| --- | --- | --- |
| `high` | 国家控制媒体,推动政府叙事 | Xinhua(CCP)、TASS/RT(俄罗斯)、Press TV/IRNA(伊朗)、KCNA(朝鲜)、中国部委官方 feed |
| `medium` | 国家附属或有已知偏见 | Al Jazeera(卡塔尔)、France 24(法国)、DW(德国)、Voice of America(美国)、Kyiv Independent(亲乌)、Moscow Times(反克里姆林) |
| `low` | 独立新闻,有编辑标准(**必须显式声明,从不默认**) | Reuters、AP、BBC、Guardian、Bellingcat |
| `unknown` | 未审核(默认) | 未列出任何源 |

**Fail-closed 默认**: 缺失 provenance 不是独立新闻。`UNREVIEWED_SOURCE_RISK = { risk: 'unknown', note: 'Provenance not yet reviewed — do not treat as independent journalism' }`。宣传徽章:unknown 永远浮出,静默从不暗示独立;显式审核的 low 才不显示徽章。

### 特殊说明

- **官方军事发布**(台湾 MND、日本统幕): 类型 gov、风险 high,注明"官方主张,非独立观测";仅人工审阅的日本文档作为区域增补
- **交易所权威**(上交所/深交所): 风险 high 但**省略 stateAffiliated**,避免把交易所权威与国控媒体混淆;metadata-only 源
- **国家附属字段**(stateAffiliated): 只有高/中风险 profile 携带

## 判断准则(给 LLM)

1. 评估一条新闻:先查 SourceType + Tier,再看 PropagandaRisk,最后看是否被独立源验证(双源原则)
2. `unknown` 风险 = 未审核,不能当独立媒体;`unknown` 类型 = 未审核,不能发明类型
3. 官方声索(政府/军队发布)是"主张"不是"测量",叙述时区分"据官方称"与"独立观测到"
4. 国家附属媒体仍在源列表里(完整性),但引用时须标注其立场 —— 排除 ≠ 可信,标注 ≠ 不可用
