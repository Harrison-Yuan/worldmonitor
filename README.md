# WorldMonitor 懂行知识 MCP

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Harrison-Yuan/worldmonitor)

> 点上方按钮:网页登录 Cloudflare → 授权 GitHub → fork 部署,无需本地安装任何东西。
> 本仓库即该 MCP 项目(独立、自包含)。点上方按钮:网页登录 Cloudflare → 授权 GitHub → fork 部署,无需本地安装(官方文档: [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-button/))。

自包含的"数据分析师 knowhow"资产包:**懂行数据 + MCP server**,零依赖、不挂接 WorldMonitor 项目,整个目录拷到哪里都能跑。

核心理念:模型拿到的不是一堆 feed,而是一套**判断方法** —— 根据用户提问,知道**查什么信息、从哪查、查出来如何验证判断分析、给出什么有效信息**。

## 目录结构

```
knowledge-mcp/
├── package.json          # 零依赖,node >= 18
├── server.mjs            # MCP stdio server(JSON-RPC 2.0;2026-07-28 最新语义 + 旧版回退)
├── lib/
│   ├── knowledge.mjs     # 分析规划 + 知识检索(纯函数)
│   └── datasource.mjs    # 数据获取层:端点注册表 + fetch 执行器(超时/错误归一)
├── data/                 # 懂行数据(纯 JSON/Markdown,可独立维护)
│   ├── endpoints.json    #   数据端点注册表(62 个核心 RPC,含参数/路径/auth)
│   ├── routing/          #   分析路由:问题 → 查什么/从哪查/怎么验证/输出什么 + 端点建议
│   ├── sources/          #   数据源注册表(13 领域)+ 来源可信度
│   ├── signals/          #   信号/阈值注册表 + CII 方法论
│   ├── methods/          #   方法论:缓存新鲜度 / 采集去重 / fail-closed
│   ├── lessons/          #   负知识索引(39 条踩坑教训)
│   └── schema/           #   条目的 JSON Schema 契约
└── test/
    └── smoke.test.mjs    # 26 项测试:逻辑 + 数据层(mock fetch)+ MCP 协议
```

## 启动与配置

```bash
node server.mjs            # 或 npm start
npm test                   # 跑冒烟测试
```

零依赖,只需 Node >= 18。不需要 npm install。

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `WM_API_BASE` | `https://worldmonitor.app` | 数据查询的 API 基址(可指向自建/镜像) |
| `WM_API_KEY` | 空 | Pro 端点密钥,经 `X-WorldMonitor-Key` 注入;匿名端点无需 |

## 暴露的工具

### `plan_analysis`(核心)
输入一个提问,返回结构化分析计划:

- **information_needs** —— 该查什么(信息需求分解)
- **sources** —— 从哪查(数据源 id/名称/领域/新鲜度,来自注册表)
- **signals** —— 相关信号与判定阈值
- **verification** —— 如何验证(双源交叉、fail-closed、来源可信度、新鲜度)
- **caveats** —— 必须知道的前提与坑
- **endpoints** —— 可执行的端点建议(直接用 `query_data` 调用)
- **output_framework** —— 给用户的有效信息输出结构

确定性路由(关键词匹配,不调 LLM),无命中时回退国家综合风险计划。模型应"先规划、再取数、后输出"。

### `search_knowledge`
检索懂行知识库:数据源 / 信号 / 负知识(踩坑教训)/ 方法论。做判断前先查对应领域的坑与规则。

### `list_endpoints`
列出 `query_data` 可调用的端点(62 个核心 RPC),支持关键词过滤。

### `query_data`(数据获取层)
按端点 id 执行数据查询,让"查数"真正可执行:

- 只传 `data/endpoints.json` 注册表声明的参数(无关参数被过滤)
- 响应透传上游 JSON(含 `cached_at` / `stale` 新鲜度信封)
- 失败归一:参数缺失 / HTTP 错误 / 401(auth_required)/ 超时(timeout),以 `isError` 信封返回

## Resources(方法论文档)

方法论与端点目录还暴露为 MCP resources,模型可直接读取全文:

| URI | 内容 |
| --- | --- |
| `wm-knowledge://methods/caching` | 缓存与新鲜度方法论 |
| `wm-knowledge://methods/sourcing` | 数据采集方法论 |
| `wm-knowledge://methods/fail-closed` | Fail-Closed 判断原则 |
| `wm-knowledge://credibility` | 来源可信度分级 |
| `wm-knowledge://cii` | CII 风险指数方法论 |
| `wm-knowledge://endpoints` | 端点注册表全文 |

## 数据维护

数据全部在 `data/`,纯 JSON/Markdown,改完即生效(server 每次调用时加载)。

| 位置 | 内容 | 维护约定 |
| --- | --- | --- |
| `data/endpoints.json` | 数据端点注册表 | 新增端点按相同字段追加;删除端点同步清理 `analysis-routes.json` 的引用 |
| `data/routing/analysis-routes.json` | 分析路由(问题类型 → 计划) | 新增问题类型时添加 route;keywords 中英双语;`endpoints` 必须存在于端点注册表(测试校验) |
| `data/sources/registry.json` | 数据源注册表 | 新增/变更数据源时更新;caveats 记录真实坑 |
| `data/sources/credibility.md` | 来源可信度(wire/gov/intel + tier + propaganda risk) | 与 shared/source-provenance 语义一致 |
| `data/signals/registry.json` | 信号与阈值 | 阈值改动先改这里,再同步产品 |
| `data/lessons/index.json` | 负知识索引 | 新踩坑先写 docs/solutions,再浓缩一条到这里(带 source 原文路径) |
| `data/methods/*.md` | 方法论 | 以"判断准则(给 LLM)"为每篇结尾 |

## 接入 MCP 客户端

### Claude Code
```json
// ~/.claude/settings.json 或项目 .mcp.json
{
  "mcpServers": {
    "wm-knowledge": {
      "command": "node",
      "args": ["/绝对路径/server.mjs"]
    }
  }
}
```

### Claude Desktop
```json
{
  "mcpServers": {
    "wm-knowledge": {
      "command": "node",
      "args": ["/绝对路径/server.mjs"]
    }
  }
}
```

### 任意 MCP 客户端 / 手动验证
```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"plan_analysis","arguments":{"query":"台湾海峡局势是否升级"}}}' \
  | node server.mjs
```

## 部署到外部 / Cloudflare Workers

三种方式,共用同一套处理逻辑([lib/mcp-handler.mjs](lib/mcp-handler.mjs)):

| 方式 | 适用 | 操作 |
| --- | --- | --- |
| **stdio(本地)** | 个人本地工具 | `node server.mjs` |
| **网页一键部署(按钮)** | 分享给任何人 | 点 README 顶部按钮,网页登录即部署 |
| **CLI/CI 部署** | 自托管/自动化 | `npm run deploy` 或 GitHub Actions |

> **部署前置(三种远程方式通用)**:仓库必须包含生成物 `lib/data-inline.mjs`(Workers 无文件系统,数据已内联)。改动 `data/` 后执行 `npm run build:worker` 并提交,否则线上数据过期。

### 网页一键部署(Deploy to Cloudflare 按钮)

README 顶部的按钮是 Cloudflare 官方的 [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-button/):

1. 用户点击 → Cloudflare 网页登录/注册
2. 授权 GitHub → Cloudflare 把仓库 **fork 到用户账户**
3. 设置页确认仓库名/Worker 名 → **Workers Builds 自动构建部署**
4. 部署完成后按 `.dev.vars.example` 设置 `AUTH_TOKEN`(在 Cloudflare 面板 Secrets 或 `wrangler secret put`)

使用前提(均已具备):仓库有 `wrangler.toml` + `main` 入口(worker/index.mjs);secrets 用 `.env.example`/`.dev.vars.example` 声明。

### 一键部署到 Cloudflare Workers(CLI)

```bash
npm run deploy:cli      # 生成内联数据 → 检查 wrangler → 部署 → 输出 URL → 提示配置
```

首次部署前先 `npx wrangler login`(或设置 `CLOUDFLARE_API_TOKEN`)。部署后按提示设置 secrets:

```bash
npx wrangler secret put AUTH_TOKEN    # 生产必设:外部访问令牌
npx wrangler secret put WM_API_KEY    # 可选:WorldMonitor Pro 密钥
```

> 说明:按钮部署(Workers Builds)与 CI 都直接用 `npx wrangler deploy`(package.json 未设自定义 `deploy` script,数据已内联提交,无需 build 步骤)。

**CI 自动部署**(可选):推送到 main 时自动部署 —— 在 GitHub 仓库设置 `CF_API_TOKEN` / `CF_ACCOUNT_ID` 两个 secrets 即可(workflow 见 `.github/workflows/deploy.yml`)。

### 本地 HTTP 预览(Streamable HTTP)

```bash
npm run build:worker   # 生成内联数据 lib/data-inline.mjs(改动 data/ 后需重跑)
npm run dev:worker     # npx wrangler dev,默认 http://localhost:8787/mcp
```

**配置(生产必做)**:

| 配置 | 方式 | 说明 |
| --- | --- | --- |
| `AUTH_TOKEN` | `npx wrangler secret put AUTH_TOKEN` | 外部访问令牌(必设,否则任何人可调) |
| `WM_API_KEY` | `npx wrangler secret put WM_API_KEY` | WorldMonitor Pro 密钥(query_data 出站用) |
| `ALLOWED_ORIGINS` | wrangler.toml `[vars]` | Origin 白名单(逗号分隔),防 DNS rebinding;留空不校验 |
| `WM_API_BASE` | wrangler.toml `[vars]`(默认已配) | query_data 数据源基址 |

鉴权方式:请求头 `Authorization: Bearer <AUTH_TOKEN>` 或 `X-API-Token: <AUTH_TOKEN>`。

### 客户端远程连接(2025-11-25+ 的 http 类型)

```json
{
  "mcpServers": {
    "wm-knowledge": {
      "type": "http",
      "url": "https://wm-knowledge-mcp.<account>.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <AUTH_TOKEN>" }
    }
  }
}
```

### 安全说明(Streamable HTTP)

- **Origin 校验**:配置 `ALLOWED_ORIGINS` 后,带非白名单 Origin 的请求返回 403(防 DNS rebinding)
- **鉴权**:不设 `AUTH_TOKEN` 时端点完全开放,公网部署务必设置
- 服务端无 cookie/session,客户端身份只来自令牌;CORS 头仅用于浏览器直连场景

## 发布到 MCP Registry(让更多人发现)

目录已备好官方 registry 元数据([server.json](server.json)、package.json 的 `mcpName`),可发布到官方与第三方目录:

```bash
brew install mcp-publisher        # 官方发布 CLI(首次)
mcp-publisher init                # 生成/校验 server.json(已存在,按需调整 URL)
mcp-publisher publish             # 发布到 registry.modelcontextprotocol.io
```

- **官方 MCP Registry**:`registry.modelcontextprotocol.io`,用 `io.github.koala73/*` 命名空间(GitHub 验证)
- **第三方目录**(提交即可被主流客户端发现):mcp.so、Smithery(CLI 安装)、Glama、PulseMCP、punkpeye/awesome-mcp-servers(PR)
- 提交时准备同一份元数据:名称、一句话能力描述、工具数、传输类型(stdio + Streamable HTTP)、仓库 URL、鉴权配置片段

## 生态最佳实践对照(2026)

| 实践 | 头部 MCP 的做法 | 我们的状态 |
| --- | --- | --- |
| 传输 | 本地 stdio + 远程 Streamable HTTP | ✅ 双形态 |
| 小而精 | 每多一个工具都是上下文税 | ✅ 4 个工具,克制 |
| 一键部署 | LobeHub/Smithery 一键安装 | ✅ `npm run deploy` + CI 自动部署 |
| 鉴权演进 | 远程标准向 OAuth 2.1 收敛 | ⚠️ 当前 AUTH_TOKEN,可后续升级 |
| Registry 元数据 | server.json + mcpName | ✅ 已备好 |
| 协议 | 2025-11-25 主流,2026-07-28 最新语义 | ✅ 双语义兼容 |

## 设计原则

1. **自包含**:不 import 项目任何模块,只读 `data/`。整个目录可复制、可离线运行。
2. **双层**:结构化 JSON(程序/MCP 精确返回)+ 叙述 Markdown(模型读上下文)。
3. **可溯源**:每条知识能回到产品文档/代码;负知识带原文路径。
4. **Fail-closed**:knowledge 内容同样遵守"缺失 = 未知 = 不采信"。
