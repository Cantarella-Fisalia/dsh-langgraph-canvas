# P3 节点行为任务 API 与 Harness 接入契约

批次 P3-BEHAVIOR-001 / HARNESS-COMPLETE-001，2026-10-24，schemaVersion:1。真实 adapter 已实现，完整功能闭环交付用户试用；用户账号生成与桌面验收待反馈。本文件保留通用端口，并记录当前实际适配实现。

## 当前版本：会话接入（2026-10-26，v0.6.0）

本节取代后文历史实现对 llm.stream／全局默认模型的描述。行为任务携带 sessionId，assignment.session={sessionId,projectRoot}；projectRoot 用于核对当前会话目录，不作为写入目标。模型请求成为当前会话的真实回合，保留上下文与会话所选模型，输出仍仅由 adapter 校验后写自有临时副本。原项目必须另行审阅、确认应用。

GET /behavior-support?sessionId=... 返回 available（可监视）与可选 canSubmit（可新提交）；会话忙碌时 available:true,canSubmit:false，仍可查状态及取消已登记任务。普通对话不会被抢占。每轮工具隔离、共享租约、取消与恢复见 DEEP_ANALYSIS_API.md。宿主 journal 绑定完整 assignment（含 session）摘要，重复提交先找持久记录，不因当前会话正在执行而拒绝既有回执；不会把相同任务重新送给其他会话。

## 1. 工作流程

1. 编辑节点职责，或增加带职责的新节点／改变路由分支，明确确认生成源码预览。
2. 预览保存了确定版本的结构、职责和源码快照。勾选行为请求确认，再点“确认并交给 Harness”，才登记任务。
3. 后端创建独立的 Python 源码临时副本，交给 adapter 的只有该工作目录、允许修改的相对文件、职责与图上下文；不传原项目路径作为编码工作目录。
4. 在“行为任务”查看状态、手动刷新或明确确认取消。面板打开且任务未结束时，每 2.5 秒查询所选任务；关闭面板只停止本页监视，不是取消宿主任务。
5. 宿主确认成功且已停止写副本后，主功能执行静态验收。通过则生成新的 `kind:behavior` **待应用事务**。点击“审阅生成代码”，勾选审阅后再单独确认应用；仍走第三步的版本检查、快照、失败恢复与撤销。

可从 prepared 结构预览直接生成“结构＋行为”的完整结果，也可在已 applied 的结构记录上继续实现占位函数；后者以当前已应用版本作为新事务基线。不自动应用、不执行用户项目、不运行模型生成的测试或脚本。

## 2. HTTP 接口

基础 `/api/v1`；Harness 嵌入 `/langcontour/api/v1`，沿用现有同源委托。

| 方法 | 路径 | 返回／用途 |
|---|---|---|
| GET | `/behavior-support` | `{available, mode:"workspace-task", message}`；未注入 adapter 时 available:false |
| POST | `/projects/{id}/behavior-tasks` | 明确确认后登记，202 返回 BehaviorTask；宿主调用异步进行 |
| GET | `/projects/{id}/behavior-tasks` | `{tasks: BehaviorTask[]}`，持久状态列表，不自动创建／重发任务 |
| GET | `/projects/{id}/behavior-tasks/{taskId}` | 查询宿主进度；必要时静态验收已成功结果，不写原项目源码 |
| POST | `/projects/{id}/behavior-tasks/{taskId}/cancel` | 明确确认取消，200 返回当前状态；未获停止确认不能显示 cancelled |

创建：

```json
{
  "schemaVersion": 1,
  "requestId": "behavior-该源码事务的32位id",
  "transactionId": "已生成预览的32位事务id",
  "reviewHash": "预览事务的64位reviewHash",
  "confirmed": true,
  "sessionId": "session-当前会话编号"
}
```

取消：`{"schemaVersion":1,"confirmed":true}`。请求不接受模型代码、输出路径、原项目工作目录或宿主任务编号。原项目按已打开的 projectId 定位；源码与职责只来自持久事务。

`BehaviorTask` 包含 `id / requestId / transactionId / graphId / baseRevision / status / createdAt / updatedAt / message / requirements`，以及可选 `hostTaskId / resultTransactionId / cancelRequested`。前端拿到的 id 是**本地主功能任务编号**，不是伪造的宿主编号；hostTaskId 只有取得真实回执／查询结果后才出现。私有目录、令牌、原始字节快照不返回前端。

默认前端的 requestId 固定由父事务 ID 派生，组件重载或响应丢失重试不会建立重复任务。失败／取消后可“准备新一次重试”，再次确认才创建新任务；重试 ID 由上次任务 ID 派生，重复点击同样幂等。conflicted 需要重新读取源码并建立新草稿。原 `/edit-requests` 和 `editRequestAdapter` 保留兼容，其性质仍是意图接收，不能代替本契约的临时工作区编码。

## 3. 乙方实现端口

类型：`packages/contracts/src/behavior.ts`。在 `createApplication({repoRoot, ..., behaviorTaskAdapter})` 注入：

```ts
interface HarnessBehaviorAdapter {
  support?(): { available: boolean; mode: 'workspace-task'; message: string };
  submit(assignment, { signal }): Promise<{ hostTaskId: string }>;
  getStatus({taskId, idempotencyKey, hostTaskId?}, { signal }): Promise<{
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
    hostTaskId?: string; message?: string;
  }>;
  cancel({taskId, idempotencyKey, hostTaskId?}, { signal }): Promise<{
    acknowledged: boolean; message?: string;
  }>;
}
```

上面是项目定义的端口，**不是 Harness 官方方法名**。乙方需核实实际桌面版本的宿主任务 API，把其映射到这三个方法，并在 `plugins/harness` 或协议约定的适配目录实现；不另起一套原项目写回实现。

assignment 字段：

- `schemaVersion:1, taskId, idempotencyKey`：幂等键为本地主功能 taskId。
- `workingDirectory`：后端自建的绝对临时目录。
- `allowedFiles:string[]`：允许改动的相对 Python 文件。
- `requirements[]`：`nodeId, functionRef, description, kind:node|route, file, symbol, affectedNodes`；路由可带真实类型的 `branchValues`，保留字符串／布尔／整数差异。
- `graph`：临时副本的静态图及 State。
- `instruction`：只改目标函数体／docstring，保留签名、构图和其他代码，必要时只增加不覆盖已有名称的模块导入。
- `originalProjectWriteAllowed:false, executeProjectAllowed:false`：不允许把任务指向原项目或运行项目。

接入必须满足：

1. 以 workingDirectory 为实际编码 cwd，并在宿主写入权限／工具配置中限制范围；不能只把“不要改原项目”写在提示词里。主功能不是模型执行的 OS 沙箱，不能限制一个主动违规的 adapter 自己去写其他路径。
2. submit 持久幂等，同 idempotencyKey 只执行一次。主功能在调用前已经落盘 submitting；回执不确定时不会重发。getStatus 必须只查询已有任务；没有 hostTaskId 时按幂等键找回，不能隐式新建。
3. succeeded／failed／cancelled 表示宿主已停止对副本的写入，不能仅代表消息显示“完成”。succeeded 必须有可核对的 hostTaskId，编号改变会进入 needs_attention。
4. cancel 的 acknowledged:true 必须保证停止、不会迟到启动。false 仅表示等待确认；主功能会查询最终状态再结束取消。取消请求一旦记录就优先于迟到成功，不导入其结果。
5. AbortSignal 用于本次 RPC 的超时／监视关闭，不等于用户已取消宿主执行。插件卸载会停止监视并关闭本地 worker；真实宿主任务是否继续由乙方明确记录，不能伪报已取消。重新接入后按已存幂等键查询，不重新执行。

每次 adapter RPC 默认 15 秒超时，可用 ApplicationOptions.behaviorRequestTimeoutMs 配置；不是整个模型任务的最长运行时间。Python 静态操作沿用 30 秒超时。接口断开、回执丢失、查不到任务时保存 needs_attention 和副本，不自动重试 submit。

## 4. 临时副本与静态验收

自有 OS 临时目录前缀 `langcontour-behavior-*`，带所有权标记；复制静态分析中的 Python 源码，最多 16 MiB、单文件 2 MiB，沿用扫描上限。不复制 `.git`、环境、密钥配置、依赖或数据资产，故**不是可直接运行的完整项目副本**。需要依赖或其他文件时本版会拒绝或要求用户先手动准备，不能悄悄扩大读取范围。

验收会：

- 核对原项目完整源码版本，快照前后检查摘要；发生变化标 conflicted，不覆盖或自动变基。
- 检查临时目录所有权、链接与文件集合；拒绝新增／删除文件、符号链接／Junction、未授权文件变动和大小超限。
- 对结果编译为 Python code object 以检查语法上下文，**从不 exec／import 用户模块**。
- 对允许文件比较 AST：仅允许列出函数的 body/docstring 改变，签名、装饰器、其他函数、State 和构图不变；保留原有模块导入，仅允许不覆盖已有绑定的新导入。模块级新 helper 不支持，可放入目标函数或先由用户手动加入。
- 每个请求函数需有实际函数体变化，只有改 docstring／格式不算完成；拒绝已识别的 NotImplementedError 和空实现。
- 重新解析全部图，节点／State／路径／等待分组必须保持预览结构；检查副本在读取期间未继续变化。
- 保存完整差异、原始字节与生成字节到第三步事务，包含 originRequestId 和 behaviorTaskId。共享函数影响会通过 affectedNodes 和审阅警告显示。

AST 校验不能证明业务正确、安全、所有动态占位都已消除，亦不校验外部包可用性。允许文件中的注释／格式可能变化，完整差异必须人工审阅；新增导入也可能需要后续安装与运行验证。

成功结果存入事务并落盘 review_ready 后才清理自有副本；取消获得停止确认后可清理。删除前校验绝对目录、所有权及链接范围；清理失败会明确保留。失败、冲突、回执未知的副本保留用于定位；不能在未知宿主仍可能写入时删除。任务记录位于 `.vislang/behavior-tasks/{id}.json`，仅本地保存，含源码快照；100 条／总 256 MiB／单条 64 MiB，最多 3 个未结束或待核对任务。超限需用户自行归档，当前没有自动清理历史的 API。

## 5. 状态与错误

| 状态 | 含义 |
|---|---|
| submitting | 本地已确认并保存，尚未取得宿主回执 |
| queued / running | 宿主已排队／正在实现 |
| cancelling | 已请求取消，尚未确认停止 |
| cancelled | 宿主已停止，结果未导入 |
| needs_attention | 回执／通道／状态不确定，保留副本，按幂等键核对 |
| review_ready | 静态验收通过，已有待应用事务；不表示业务测试通过 |
| failed | 宿主失败或结果不符合修改范围／语法／占位要求 |
| conflicted | 原源码已变化，结果未导入 |

常见错误：400 CONFIRMATION_REQUIRED / INVALID_BEHAVIOR_REQUEST / NO_BEHAVIOR_REQUIREMENTS / MISSING_BEHAVIOR_REQUIREMENT；404 TASK_NOT_FOUND；409 SOURCE_CHANGED / REVIEW_CHANGED / REQUEST_ID_REUSED / INVALID_STATE / RECOVERY_REQUIRED；423 PROJECT_LOCKED；429 TASK_LIMIT / ACTIVE_TASK_LIMIT；503 HARNESS_NOT_CONNECTED。已登记后的 adapter 错误以持久 needs_attention 状态返回，不伪装成“未启动”。结果验收失败以 task.status 与 message 表示，原源码不改。

SSE 增加 `behavior.changed` 通知，不承载模型代码或伪造进度百分比。GET 列表只读已存状态；GET 单任务才向 adapter 查询并可生成结果审阅事务。没有后台自动发起／重发任务；页面关闭后，下一次查询可继续核对已存在的宿主任务。

## 6. 本批验证与乙方待办

54 项模块／协议检查通过：20 Node + 34 Python。合成 adapter 的隔离 UI 验证了显式确认、运行状态、结果静态验收、再次审阅确认应用及撤销。**不是实际 Harness 编码验证**。

乙方需补：实际桌面任务创建、受限工作目录、幂等持久化与未知回执找回、取消确认、模型结束后不再写副本、真实生成函数的应用与撤销、原源码冲突、插件卸载／重载、工作区与主题切换，并记录 `docs/handoffs/integration/P3-BEHAVIOR-001.md`。上述为 P3 初次交付的历史待办；当前默认插件已经注入实际 adapter。服务或默认模型缺失时仍明确禁用，不用测试提供方代替用户真实模型的验收。

## 7. 当前真实 Harness 适配（HARNESS-COMPLETE-001）

正式路径 `plugins/harness/lib/behavior-adapter.js`；宿主 `lib/index.js` 注入，并在卸载时先 await adapter.close()，再关闭后端。当前版本插件 0.3.0，核对本机 Harness 0.2.1-rc.2 的实际源码与运行时。用 ctx.get('llm')、ctx.get('agentDefaultModel') 读宿主服务，默认选择来自 currentSelection()；调用 llm.stream({provider, model, reasoningEffort?, messages, tools:[], signal})。没有新建普通会话或 agents.create 的 Agent，任务只在插件“行为任务”显示；hostTaskId 是已持久登记的插件宿主任务 ID `langcontour-<taskId>`，不冒充 Harness 会话编号。

模型没有文件、终端或执行能力，返回明确 JSON 文件集合；adapter 使用 workingDirectory 的绝对路径做读写，不切换用户工作区、不传原项目作为编码目录。写入前核对所有权、相对路径、链接、文件集合和所有输入摘要。副本写完且无待写操作后才返回 succeeded；原项目写回仍只经过事务确认。

模型调用使用宿主自己的配置、账号与传输，不由插件读取或复制凭据。support() 是可选动态就绪查询，后端同时用于按钮能力与提交准入；它只验证服务、默认模型和已加载提供方，不发请求或验证额度。账号／网络错误在真实任务后返回。既有没有 support() 的 adapter 仍按原端口兼容。

宿主回执保存在仓库 `.vislang/harness-tasks`；先以 wx 独占建立并 fsync 登记，再异步调用模型，同一键不重复执行。GET 只查已存在的记录；进程已退出的未结束记录转 failed，不自动恢复生成。插件卸载会中止本 adapter 的写入，持久取消／失败状态可查询；关闭前端面板不影响执行。另一个仍活跃宿主进程的任务不能伪报已取消，需在原实例停止后刷新。

取消通过中断信号终止本地生成／写入路径并等待本地操作结束。即使提供方不遵守网络 abort，迟到文本没有任何写文件路径，因此不能迟到写入。主功能 RPC 的 AbortSignal 不等于取消宿主生成；submit 已登记后回执丢失，可由稳定幂等键查询。

本版行为生成只支持 UTF-8（含 BOM、CRLF），源上下文合计 2 MiB、单文件 2 MiB，生成响应有大小限制，最长 10 分钟。完整结果含每个允许文件一次，不接受任意路径、工具调用、截断流或无有效 JSON 的结果。新增模块／模块级 helper／改签名仍按第 4 节拒绝。

当前 61 项自动检查、类型／构建通过；实际隔离 Harness 的原生架构页通过完整操作链，使用测试提供方且未触达用户账号。详见 [本批交付](../handoffs/main/HARNESS-COMPLETE-001.md)，用户首测按 [使用指南](../../USER_GUIDE.md)。
