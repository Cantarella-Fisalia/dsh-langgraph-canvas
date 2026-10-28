> 第四步新增正式临时工作区行为端口与任务 API，见 [P3_BEHAVIOR_TASKS_API](P3_BEHAVIOR_TASKS_API.md)。本页旧 edit-requests 仅保留意图接收兼容，前端 Harness 执行入口已使用新契约；不能用旧接收器直接执行源码修改。

# P2 结构草稿与确认提交接口 v1

批次：P2-DRAFT-001。阶段：五步路线中的第一步，仅编辑结构意图，不写回源码。沿用 P1 API 前缀、来源校验与错误格式。新增类型在 packages/contracts/src/editing.ts；Python 返回的 GraphDocument 协议保持不变。

P1 的 structuralEdit:false 继续表示尚不支持源码结构写回，与前端本地草稿编辑区分。health 的 readOnly:true 也继续表示源码不写入。

## 本地草稿

画布节点、连线、条件分支、整组等待汇合和 State 字段的修改保存在浏览器本地，键为 dsh-langgraph-canvas:structure-draft:{projectId}:{graphId}。包含原始结构、目标结构、源码版本、请求编号和可选回执。

只有保存表单才更改草稿；拖拽端口先打开连线表单，可以取消。切图后分别恢复对应草稿。源码版本变化后旧草稿保留，画布显示最新源码；旧草稿不可编辑或提交，须核对后放弃并重新编辑。本阶段不自动合并旧草稿。

本地草稿不包含源码修改；新节点／边不伪造源码位置。存在结构草稿时仅预览布局，不向原图布局接口保存新增节点。布局变更、打开页面、恢复草稿、刷新状态和查看修改清单均不提交 Harness 请求。浏览器存储不允许写入时提示草稿仅保留在本页。

## 读取接收通道

GET /api/v1/edit-support

```json
{
  "available": false,
  "mode": "request-only",
  "message": "Harness 编码请求通道尚未接入。当前可编辑本地草稿，暂不能提交修改任务。"
}
```

available 由后端是否注入 EditRequestAdapter 决定。未接入时最终“确认并交给 Harness”按钮禁用；用户仍可编辑、保存和查看草稿。接入后也不自动提交，必须再次明确点击最终按钮。

## 明确确认后提交

POST /api/v1/projects/{id}/edit-requests

```json
{
  "schemaVersion": 1,
  "requestId": "4aa4f2c5-1234-4c3b-a404-3be2e89f4594",
  "graphId": "graph.py::builder",
  "baseRevision": "解析结果中的源码版本",
  "confirmed": true,
  "target": {
    "state": { "reference": "TeamState", "fields": [{ "name": "topic", "annotation": "str" }] },
    "nodes": [
      { "id": "__start__", "description": "" },
      { "id": "__end__", "description": "" },
      { "id": "writer", "functionRef": "writer", "description": "根据资料写作" }
    ],
    "edges": [
      { "id": "start-writer", "from": "__start__", "to": "writer", "kind": "normal" },
      { "id": "writer-end", "from": "writer", "to": "__end__", "kind": "normal" }
    ]
  }
}
```

requestId 实际格式为 8–100 个 ASCII 字母、数字、短横线或下划线。body 中不接收项目根路径，后端从已打开的项目记录取得真实目录；上述完整结构仅为格式说明，必须基于实际原图构造。

后端检查 confirmed 严格等于 true、请求结构、最新源码版本、节点／字段唯一性、有效端点、START/END 规则、条件分支值唯一性、汇合组一致性及 START 可达性。新节点必须有函数名称。State 的原引用不允许更换；类型注解仅为文本，不执行或声称已通过 Python 语法检查。确认时至少一个业务节点，草稿编辑过程中允许暂时存在未连接节点。

边格式：normal 仅需 from/to；conditional 另需 label（本阶段文本分支值）和 route（函数引用）；join 另需 joinId，同组至少两个不同来源且只有一个目标。删除节点时清理关联边，关联汇合按整组清理；删除汇合成员时移除整组，避免改变等待语义。

收到后的 202：

```json
{
  "requestId": "4aa4f2c5-1234-4c3b-a404-3be2e89f4594",
  "taskId": "接收器返回的实际任务编号",
  "status": "accepted",
  "message": "结构请求已被接收，源码尚未应用。请在 Harness 中核对后续任务状态。"
}
```

accepted 只代表接收器接收了意图，不代表任务已运行或源码已改动。前端保存回执、锁定该草稿并禁用重复提交；清除本地草稿不会取消已接收任务。任务状态／取消在第四步实现。

同一进程内按 projectId + requestId 去重：内容相同返回原回执，包括并发点击；内容不同返回 REQUEST_ID_REUSED。缓存最多 500 个成功／正在提交的请求，服务重启后由接收适配器按 requestId 保证持久幂等。适配器失败允许重试，仍须自己处理“已经接收但回执丢失”的幂等问题。

错误包括 CONFIRMATION_REQUIRED(400)、INVALID_EDIT_REQUEST(400)、INVALID_GRAPH_DRAFT(400)、NO_CHANGES(400)、SOURCE_CHANGED(409)、REQUEST_ID_REUSED(409)、HARNESS_NOT_CONNECTED(503)、INVALID_ADAPTER_RECEIPT(502)、REQUEST_LIMIT(429)。失败保留前端草稿，不伪装成任务已提交。

## 乙方接收器接入点

ApplicationOptions 新增可选 editRequestAdapter：

```typescript
const application = createApplication({
  repoRoot,
  apiPrefix: '/dsh-langgraph-canvas/api/v1',
  editRequestAdapter: {
    async submit(intent) {
      // receiver 是乙方需要实现的接收器，并非已确认存在的 Harness API。
      const task = await receiver.enqueue(intent)
      return { taskId: task.id }
    }
  }
})
```

ConfirmedEditIntent 包含 project、graphId、baseRevision、original、target、后端生成的 changes、requestId、confirmedAt 以及 sourceWriteAllowed:false。本阶段接收器只能接收／排队结构意图，不能通过此回调直接修改原项目。步骤 2／3 完成临时副本、代码差异、检查和应用事务后，再接通真实编码执行；届时必须在执行／应用前再次校验源码版本，当前提交检查不替代写入时冲突校验。

当前插件未注入接收器，正式默认 available:false。本轮仅用测试接收器验证确认门禁，不代表真实 Harness 编码任务已经接通。
