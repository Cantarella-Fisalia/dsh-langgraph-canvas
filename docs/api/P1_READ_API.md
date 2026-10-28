# P1 读取与布局接口 v1

状态：主功能侧已实现；Harness 桌面适配与验收由乙方完成。实际类型见 packages/contracts/src/index.ts，Python 返回边界由 validation.ts 验证。

## 独立服务

- 启动：npm.cmd run dev:api。默认仅监听 127.0.0.1:4318。
- 环境：VIS4AGENT_PORT、VIS4AGENT_PYTHON（解释器可执行文件路径，不是附带参数的 shell 命令）。
- 协议：JSON UTF-8；请求体上限 1 MB，源码文件上限 2 MiB，每项目最多扫描 500 个 Python 文件。
- 项目注册保存在内存；服务重启后重新打开项目，画布位置仍从项目布局文件恢复。
- 项目目录由用户显式输入，不执行项目；读取布局时可能创建 .vislang 目录。

## 路由

| 方法 | 路由 | 含义 |
|---|---|---|
| GET | /api/v1/health | 服务状态及只读阶段 |
| GET | /api/v1/capabilities | MCP/RAG/Tools/Skills 预留状态 |
| GET | /api/v1/projects | 本进程已打开的项目 |
| POST | /api/v1/projects | 打开项目并首次解析 |
| GET | /api/v1/projects/{id}/graphs | 重新读取项目图与诊断 |
| GET | /api/v1/projects/{id}/source?file=nodes.py | 项目内 Python 源码 |
| GET | /api/v1/projects/{id}/layout?graphId=... | 已保存布局和布局版本 |
| PUT | /api/v1/projects/{id}/layout | 按版本保存节点位置 |
| GET | /api/v1/projects/{id}/events | SSE 源码变化通知 |

打开项目：

```json
{ "root": "E:/Heng/vis4agent/examples/research-team" }
```

响应：{ project: { id, name, root }, analysis: { schemaVersion: 1, graphs, diagnostics, revision, scannedFiles } }。

graph ID 示例：graph.py::builder；函数作用域示例：graph.py::build_graph.builder。不能用节点名作为整个项目的唯一 ID。源码位置中的行号从 1 开始，column 是 Python AST 的 UTF-8 字节列偏移。

图包含 nodes、edges、state、diagnostics、revision。边类型 normal / conditional / join；joinId 相同的边代表等待所有前驱的汇合，不能解释成任一前驱即可触发。kind=function 只表示解析到函数，不能据此宣称节点是完整智能体。

保存布局：

```json
{
  "graphId": "graph.py::builder",
  "graphRevision": "来自分析结果的revision",
  "baseRevision": "来自GET布局结果的revision，首次为empty",
  "positions": { "writer": { "x": 400, "y": 180 } }
}
```

返回 Layout：{ schemaVersion: 1, revision, positions }。按项目串行保存，使用临时文件替换。源码版本或布局版本过期返回 409，现有布局无效也返回 409 并保留文件。图中已移除节点不能写入新布局。

错误统一为 { error: { code, message } }。常见错误：INVALID_ROOT(400)、INVALID_SOURCE(400)、PROJECT_NOT_FOUND(404)、SOURCE_CHANGED(409)、LAYOUT_CONFLICT(409)、INVALID_LAYOUT(409，读取已有文件时)、INVALID_POSITION(400)。Python 启动或协议故障返回 500。前端应呈现错误，不伪装为空图。

## SSE

事件字段：schemaVersion、id、sequence、projectId、type、可选 revision。type 为 project.changed 或 layout.saved。心跳是 SSE 注释，不代表业务更新。

支持 Last-Event-ID，在内存保留最近 100 个事件；历史不足时发送 project.changed，客户端重新 GET /graphs 恢复。文件监听不支持的文件系统上可手动刷新。监听只关注 Python 文件；本批不是持久化作业流。

## Harness 集成入口

```typescript
import { createApplication } from './apps/backend/src/application.ts'
const application = createApplication({
  repoRoot: 'E:/Heng/vis4agent',
  pythonCommand: 'D:/Anaconda/python.exe',
  apiPrefix: '/vis4agent/api/v1',
  allowedOrigins: ['dsh-app://app']
})
// 宿主路由委托 application.handler(req, res)，返回 false 表示不匹配该前缀。
// 插件卸载时调用 application.close()，关闭 watcher、SSE 和 worker。
```

后端 .ts 使用 Node 24 类型剥离支持，不包含依赖构建器的 TypeScript 运行语法。集成方必须确认宿主 loader 可导入该入口，否则提供构建适配，不修改核心业务逻辑。

前端是独立 React 应用，其 dist 可通过宿主同源静态路径和 iframe 挂载。不要把标准 Vite 产物直接当成 __ModuleLoader__ 的客户端插件；Harness 包内的 client/client.js 仍由乙方封装入口。

配置 API base URL 可采用页面加载前的 window.__VIS4AGENT_CONFIG__ = { apiBase: '/vis4agent/api/v1' }，或 iframe URL 查询参数 ?apiBase=/vis4agent/api/v1。Vite 使用相对静态资源路径，允许挂载在子路径。宿主需处理目录首页与静态资源路径。

前端调用同源 HTTP/SSE，不应把 Harness 私有 token 写入页面配置。是否以 iframe 挂载、宿主路由如何继承鉴权，需乙方在桌面端验证。核心交付没有启动、修改或重装桌面 profile。

## Python 工作进程

命令：python -u -m vislang_worker，PYTHONPATH 指向 services/python-worker/src；后端会设置此环境变量。无额外 Python 依赖。

一行一个 JSON 请求：{ schemaVersion: 1, id, method: "analyze"|"source", params: { root, file? } }。
响应：{ schemaVersion: 1, id, result } 或 { schemaVersion: 1, id, error: { code, message } }。

请求超时 30 秒，超时关闭进程并拒绝未完成请求，下次请求重新创建。stdout 只输出协议；启动错误从 stderr 捕获。取消完整图分析的独立请求协议与作业持久化不属于本批。

## 依赖与限制

只读分析采用 Python AST，避免执行项目。未来源码写回仍使用 LibCST，不使用 ast.unparse 重写业务文件。自动排布目前采用确定性分层布局，复杂图的 ELK 排布放到后续改进。

尚未解析：运行时工厂、跨函数传递的构建器、任意重赋值、继承状态的所有字段、所有模块属性导入方式、没有显式映射的路由目的地。动态行为不被执行，也不能承诺画布完整。

参考实现依据：[LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)、[React Flow](https://reactflow.dev/learn)、[Vite 构建](https://vite.dev/guide/build.html)。
