# P2 临时源码预览 API

> 第三步 P2-TRANSACTION-001 已增加持久记录、统一差异和独立确认应用／撤销；新增字段与生命周期以 [源码事务 API](P2_TRANSACTIONS_API.md) 为准。此预览接口本身仍不写原项目源码。

批次 P2-SOURCE-001，2026-10-24，协议 schemaVersion:1。新增接口，原 P1 与 P2 草稿提交接口保持兼容。

## 目的与确认

前端“确认并生成源码预览”明确确认后，才 POST `/api/v1/projects/{projectId}/source-previews`。Harness 嵌入前缀为 `/dsh-langgraph-canvas/api/v1`，沿用现有同源委托。编辑、保存草稿、打开清单、刷新或恢复页面均不自动调用此接口。

此接口不调用 Harness adapter。原“确认并交给 Harness”仍单独控制 `/edit-requests`，默认没有 adapter 时继续禁用；不得为了启用预览而伪造 taskId 或打开编码通道。

## 请求

沿用 `ConfirmEditRequest`：

```json
{
  "schemaVersion": 1,
  "requestId": "preview-example-001",
  "graphId": "graph.py::builder",
  "baseRevision": "分析得到的完整源码版本",
  "confirmed": true,
  "target": {
    "state": { "reference": "State", "fields": [{ "name": "question", "annotation": "str" }, { "name": "answer", "annotation": "str" }] },
    "nodes": [
      { "id": "work", "functionRef": "work", "description": "" },
      { "id": "__start__", "description": "" },
      { "id": "__end__", "description": "" }
    ],
    "edges": [
      { "id": "edge-start", "from": "__start__", "to": "work", "kind": "normal" },
      { "id": "edge-end", "from": "work", "to": "__end__", "kind": "normal" }
    ]
  }
}
```

实际调用应从 graphs API 取得当前图，使用其真实 edge IDs 与 revision。前端只提交图与草稿，不接受调用方指定临时目录或输出路径。

## 响应

200，类型 `packages/contracts/src/source-preview.ts`：

- `requestId / graphId / baseRevision / generatedRevision`：本次请求及静态源码版本。
- `verified:true / originalModified:false`：已通过语法和重新解析核对，原项目未写入。
- `files[]`：仅实际变更文件，包含相对 `file`、`before`、`after`、原始字节的 `baseHash / generatedHash`、`encoding`。
- `warnings[]`：节点职责、State 字段读写及 reducer、路由返回值仍需行为验证的事项。
- `placeholders[]`：新建待实现函数；函数明确 `raise NotImplementedError(...)`。
- `behaviorRequirements[]`：新增节点或职责变化的要求，供第四步使用。既有函数体和 docstring 不因职责文本编辑而被覆盖。

只修改职责时 `files` 可以为空，界面明确解释未改变源码。`verified` 只表示静态结构相符，不代表 LangGraph compile、类型检查、业务逻辑或运行验证成功。

## 支持范围

| 对象 | 当前支持 |
|---|---|
| 构建器 | 模块或函数内直接赋值 `builder = StateGraph(State)`；独立语句注册，compile/validate 在注册之后 |
| 节点 | 新增／删除注册；替换显式 action 引用；节点改名按删除旧注册和新增注册处理，业务函数保留 |
| 函数 | 复用可静态定位的项目内函数；未绑定的简单新名称生成占位函数；不猜测外部模块 |
| 普通边 | 新增／修改／删除，START/END 使用等价的字符串常量，不改原有导入 |
| 条件边 | 显式字面量映射，按来源＋路由整组修改，支持回路；已识别布尔／整数 key 保留原类型；新分支按字符串生成 |
| 等待汇合 | `add_edge([sources...], target)`，整组保留等待语义，不拆成普通多入边 |
| State | 项目内可定位显式 class 的字段增删、注解替换；支持跨文件；保留未改字段、默认值、现有 reducer 和注释 |
| 格式 | 未修改文件原始字节直接保留；改动文件按原编码和换行写出；已测试 UTF-8 BOM、GB18030、CRLF 和中文 AST 字节列 |

构造表达式依赖 AST 定位并仅改指定片段；不对整个文件 `ast.unparse`，不新增 Python 依赖。原技术草案中的 LibCST 留待复杂构图扩展。删除语句上的注释提取为独立注释保留；需要替换的表达式中含内部注释时拒绝该修改。

以下写法保守拒绝并保留草稿：解析诊断、控制流中的构图、链式注册、构建器别名／传给 helper、无法定位的函数、共享 State 的跨图修改、同一路由多次注册、待改边上的额外参数、分号／同一行多个语句、重叠修改、含动态调用或未导入名称的新增类型注解。部分已解析但无法安全改写的写法也可能拒绝，不假定任意 Python 可逆。

路由函数体不自动变化；修改分支文字后必须核对实际返回值。State 字段删改保留节点函数，界面返回后续行为检查提示，不宣称已修复字段引用。

## 临时副本、版本和生命周期

1. 后端重新分析，校验明确确认、图存在、baseRevision、草稿合法且有修改。
2. Python 再校验版本，读取实际分析中的 Python 文件，验证字节摘要。只复制静态源码，不复制 `.git`、依赖目录或其他项目文件，不执行／导入用户模块。
3. 在自有 `dsh-langgraph-canvas-source-preview-*` 临时目录写入生成文件，检查 Python 语法，重新分析并核对目标图、State、边与等待分组；其他图结构必须保持一致。
4. 再次检查原项目版本；返回生成前后文本及摘要；退出时清理自有临时目录。响应不含可供其他任务写入的临时工作区路径；本副本不能直接用于 Harness 执行。
5. 同一进程中，相同 requestId＋内容复用在途／缓存结果；ID 对应不同内容返回 409；每次返回缓存前仍检查源版本。最多 20 个记录、64 MiB 结果缓存，已完成记录可淘汰；淘汰后可重新静态生成，该行为为第二步历史实现；第三步已改为在途合并＋项目内持久事务记录，重启后仍可读取。原项目从未由此接口写入，无需回滚。

单文件沿用 2 MiB 上限，分析最多 500 个 Python 文件，快照总量上限 16 MiB；请求上限 1 MB，worker 沿用 30 秒超时，失败可用原 requestId 重试。持久审阅、应用事务、冲突恢复和撤销现由第三步的独立事务接口提供。

## 错误

| HTTP | code | 含义 |
|---|---|---|
| 400 | CONFIRMATION_REQUIRED | 没有明确 confirmed:true |
| 400 | INVALID_PREVIEW_REQUEST / INVALID_GRAPH_DRAFT / NO_CHANGES | 请求、结构或修改内容无效 |
| 404 | PROJECT_NOT_FOUND / GRAPH_NOT_FOUND | 需重新打开项目或读取图 |
| 409 | SOURCE_CHANGED / REQUEST_ID_REUSED | 草稿过期或 ID 与内容冲突 |
| 422 | SOURCE_PREVIEW_REJECTED | 转换不支持、版本在 worker 内变化或静态核对失败；message 保留具体原因 |
| 429 | PREVIEW_LIMIT | 同时生成过多或内容超过缓存限制 |

无新增 SSE 事件，因为不改变原项目。取消当前界面不会调用 Harness；同步 worker 沿用现有超时和关闭机制，专用任务取消 API 留待后续。
