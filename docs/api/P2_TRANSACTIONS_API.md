# P2 源码审阅、应用与撤销 API

批次：P2-TRANSACTION-001。日期：2026-10-24。schemaVersion:1。由甲方实现；真实 Harness 验收由乙方执行。

## 1. 使用流程

编辑结构 → 查看修改并确认 → **确认并生成源码预览** → 审阅每个文件的差异与提示 → 勾选已审阅 → **确认应用到原项目**。

撤销：打开顶部 **源码变更记录** → 选择已应用记录 → 查看撤销差异 → 勾选确认 → **确认撤销此次修改**。

预览、查看记录、勾选和页面恢复均不会发起新的源码应用；唯一新写入入口是明确确认的事务操作。关闭正在执行的确认对话框会暂时受限，关闭宿主窗口不视为取消，未完成操作下次会检查恢复。Harness 编码仍由原来的独立确认控制，本阶段不调用 adapter。

## 2. 对第二步接口的增量

`POST /projects/{id}/source-previews` 输入不变；现在将审阅快照持久保存至所选项目 `.vislang/transactions/{transactionId}.json`，不是仅存在内存。Python 临时检查目录仍在完成后清理。

响应保留原字段，并增加：

- `files[].diff`：统一差异，带文件名、行号和上下文；`undoDiff` 是反向差异；支持无末尾换行标记。
- `transaction`：`id / requestId / graphId / baseRevision / generatedRevision / reviewHash / status / createdAt / updatedAt / files / message`。
- `originalModified:false` 继续描述**生成快照时**源码未写入，不是历史记录的实时状态。是否已应用以 `transaction.status` 为准。

相同 requestId＋相同内容在跨进程重启后仍读取原记录；同 ID 对应不同有效草稿返回 REQUEST_ID_REUSED。已应用／撤销／回滚的记录不会重新转成待应用；要再次编辑应建立新草稿、新 ID。后端仅合并在途请求，已完成内容从持久日志读取，避免返回过期状态。

职责变化可以没有文件差异，仍保存行为实现要求；这种记录不允许应用，留给第四步。带 NotImplementedError 的新函数可以在明确知悉后应用结构，函数体尚未实现这一事实不会被隐藏。

## 3. 路由

基础前缀仍为 `/api/v1`，嵌入前缀 `/vis4agent/api/v1`，使用现有同源宿主委托，不需要添加私有 Harness 调用。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/projects/{id}/transactions` | 返回 `{transactions: SourceTransaction[]}`，按创建时间倒序 |
| GET | `/projects/{id}/transactions/{transactionId}` | 返回保存的 SourcePreview 及当前事务摘要，不返回私有字节快照 |
| POST | `/projects/{id}/transactions/{transactionId}/apply` | 明确确认后应用已审阅的生成字节 |
| POST | `/projects/{id}/transactions/{transactionId}/undo` | 明确确认后恢复此事务之前的原始字节 |
| POST | `/projects/{id}/transactions/{transactionId}/recover` | 处理外部冲突后，明确重试恢复失败操作之前的快照 |

请求体：

```json
{
  "schemaVersion": 1,
  "confirmed": true,
  "reviewHash": "从该事务详情取得的64位摘要",
  "acknowledgedWarnings": true
}
```

应用必须 `acknowledgedWarnings:true`；UI 对撤销／恢复也要求勾选审阅。所有操作必须明确 confirmed:true 且 reviewHash 匹配。请求不接受文件路径、代码文本或调用方工作目录；应用内容只来自保存的生成快照。成功返回更新后的 SourcePreview，状态分别为 applied、undone；恢复结果根据原操作为 rolled_back 或 applied。

成功后重新分析并沿用 `project.changed` SSE 使画布同步。应用／撤销成功才清除对应本地草稿。错误时保留草稿，历史中显示实际状态。GET 读取可触发对之前已确认、但中断的操作的自动恢复，不发起新的应用。

`GET /health` 当前为 `stage:"p2-transactions", readOnly:false, sourceWrites:"confirmed-transactions-only"`。旧草稿请求通道和能力预留接口不变，插件健康说明若仍显示 P1 只读，应由乙方同步调整说明。

## 4. 写入与恢复

1. Python 使用 OS 项目锁：Windows 字节锁／POSIX flock，跨插件进程互斥；进程退出释放锁，锁文件保留不代表锁仍占用。常规 analyze 读请求在已建立事务目录时也经过此锁。
2. 检查日志完整性、项目路径及状态。路径拒绝符号链接、Junction、项目外路径与隐藏目录源码；只处理记录内的现有 `.py` 文件。
3. 应用要求整个静态分析版本等于 baseRevision；撤销要求等于 generatedRevision。即便无关 Python 文件改变，也保守阻止。多次修改应先撤销最近一次；不自动合并或变基。
4. 校验每个目标文件的原始字节，再将操作状态 applying／undoing 写入持久日志并 fsync；字节快照已在预览时保存。快照包括已有未提交内容，与 Git 状态无关。
5. 每个文件写入前再次比较字节；同目录临时文件写完并 fsync 后 os.replace，保留文件权限模式和内容编码。写完后重新静态分析，必须等于预期的完整源码版本，然后记录 applied／undone。
6. 普通异常会尝试恢复操作前的快照。进程中断留下 applying／undoing，下次打开项目、读取记录或分析时检查并恢复。每个文件只接受操作前或操作后两种已知字节；发现第三种版本或文件丢失，不覆盖。
7. 完全恢复后，应用失败为 rolled_back，撤销失败恢复为 applied；无法全部恢复则 recovery_required，阻止项目后续应用／撤销／新预览。用户根据日志保留的两份快照处理冲突，再明确点击“确认重试恢复”。没有强制覆盖按钮。

重复收到已完成的同一操作返回已有结果，不重新写文件；撤销后的记录不能再次 apply。没有 redo 接口。

每个文件替换是原子的，跨文件通过日志恢复一致性；**不是文件系统提供的跨文件原子事务**。项目锁只约束遵守同一协议的插件进程，不能锁住所有外部编辑器。紧邻校验与替换之间仍有文件系统竞争窗口，应避免在同一时刻保存相同文件；检测到的外部变化会阻止覆盖或转为待恢复。恢复内容保留原字节，包括 BOM、CRLF、非 UTF-8 编码；不恢复原 mtime、完整 ACL／文件身份等系统元数据，也不承诺硬件断电下的跨文件原子提交。

## 5. 状态与错误

| 状态 | 含义 |
|---|---|
| prepared | 差异已保存，尚未应用 |
| applying / undoing | 已确认操作进行中；中断后自动尝试恢复 |
| applied | 应用完成，可在源码版本匹配时撤销 |
| undone | 已恢复原始字节，不再次应用此记录 |
| rolled_back | 应用失败后已恢复，不再次应用此记录 |
| recovery_required | 外部变化或 IO 错误阻止恢复，需要处理后明确重试 |

| HTTP | code | 说明 |
|---|---|---|
| 400 | CONFIRMATION_REQUIRED / REVIEW_REQUIRED | 缺明确确认或勾选审阅 |
| 400 | NO_SOURCE_CHANGES / INVALID_TRANSACTION_ID | 无文件变化或编号无效 |
| 400 | UNSAFE_PATH | 不安全路径，不写入 |
| 404 | TRANSACTION_NOT_FOUND | 记录不存在／未生成持久预览 |
| 409 | REVIEW_CHANGED / REQUEST_ID_REUSED | 审阅摘要或请求内容不符 |
| 409 | SOURCE_CHANGED / INVALID_STATE | 源码版本或事务状态不允许操作 |
| 409 | OPERATION_ROLLED_BACK | 操作失败，但文件已恢复至操作前 |
| 409 | RECOVERY_REQUIRED / INVALID_JOURNAL | 恢复冲突或日志损坏，不继续写入 |
| 423 | PROJECT_LOCKED | 其他进程持有项目锁，稍后重试 |
| 429 | JOURNAL_LIMIT / PREVIEW_LIMIT | 日志或在途请求超过限制 |

普通文件系统错误仍可能返回 500，worker 超时沿用 30 秒；不能仅按 HTTP 错误推断“完全未写入”，应查询事务状态。日志中的快照校验摘要用于发现损坏，不是防止本地用户主动篡改的认证机制。

## 6. 存储和接入验收

每项目最多 200 条记录、总计 256 MiB，单记录最多 128 MiB；超限时明确停止，不自动删除用户历史。旧记录需由用户在无操作时自行归档，移走记录会让 UI 无法再撤销该记录。没有新增日志清理 API。原有源码扫描与体积限制继续有效。

事务记录含项目源码前后快照，仅本地保存，不上传。没有新增 Git 操作或外部服务依赖；Harness 行为实现、运行时验证、智能冲突合并与重做留待后续。

乙方应以真实桌面工作区副本验证全部确认门禁、工作区切换、浅／深色、历史跨重载、撤销、并发冲突、插件卸载和断开期间恢复，并单独记录 integration/P2-TRANSACTION-001.md。本批隔离 UI 与模块检查不能代替桌面验收。
