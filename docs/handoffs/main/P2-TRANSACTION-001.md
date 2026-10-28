# P2-TRANSACTION-001：源码应用、恢复与撤销

日期：2026-10-24。负责：甲方。状态：**待接入**（主功能完成，真实桌面未验收）。
范围：第三步；前后端确认应用、持久差异、源码版本检查、文件事务日志、失败恢复与撤销。修改 apps、packages、Python worker、测试和文档。依赖 P2-SOURCE-001。Harness 插槽、桌面 profile 及乙方证据不改。

## 交付范围

- 预览响应增加统一 diff / undoDiff、持久事务编号和审阅摘要；可切换完整源码对照。
- 审阅勾选＋独立“确认应用到原项目”；顶部“源码变更记录”可跨重载读取并明确确认撤销／重试恢复。记录本身不会自动提交应用。
- Python 独占项目锁、路径限制、完整源码版本及原始字节检查；按原始字节快照应用／撤销，操作前持久日志，逐文件同目录替换，结束后重新解析。
- 多文件失败尝试恢复；中断操作下次检查并恢复；第三种文件版本不覆盖，保留 recovery_required 并阻止项目新写入。
- 预览旧字段兼容；originalModified:false 表示生成时状态，历史以 transaction.status 为准。health 当前明确允许 confirmed-transactions-only，非 P1 只读。

完整协议、错误、状态、限制、恢复方法见 [P2_TRANSACTIONS_API](../../api/P2_TRANSACTIONS_API.md)。schemaVersion:1，无新增依赖。Harness adapter、节点行为生成与运行验证不属于本批。

## 改动文件

apps/backend/src/application.ts、worker.ts、source-previews.ts、新增 transactions.test.ts；apps/frontend/src/App.tsx、editor.tsx、source-preview.tsx、styles.css、新增 transactions.tsx；packages/contracts/src/source-preview.ts、api-client/src/index.ts；Python __main__.py、source_preview.py、新增 transactions.py 与 test_transactions.py；package.json 测试入口；计划、README、开发交接、API 文档及本批证据。dist 由构建生成。

不修改 plugins/harness、桌面 profile、示例源码或乙方验收记录；同步前核对原文件摘要，保留对方改动。

## 检查与实际结果

命令：`npm.cmd test`、`npm.cmd run build`。Node 24.13.0、Python 3.12.3、Vite 7.3.7。

- 41 项通过：15 项 Node + 26 项 Python。类型和生产构建通过；React Flow 原有 use client 提示不影响产物。
- 持久记录跨服务重启可读取；未 confirmed／缺审阅／摘要不匹配不写；重复已完成操作不重写；源码变化阻止应用／撤销；请求 ID 内容冲突跨持久记录检查。
- 两文件写入中途失败恢复；模拟进程中断的 apply／undo 在下一次打开恢复；外部第三版本保留并阻止新操作；处理冲突后明确 retry recovery；项目锁互斥与损坏日志拒绝。
- 使用 UTF-8 BOM＋CRLF 图文件和 GB18030 中文 State 文件，真实应用／撤销恢复原始字节；业务函数与既有注释保留。用户模块从不执行。
- 独立生产 UI 对真实示例副本增加 `summary: str`：生成预览 1 次，勾选前应用按钮禁用，应用前三个源码摘要不变；明确应用 1 次后只 state.py 改变；历史显示反向差异且撤销按钮勾选前禁用；明确撤销 1 次后三文件摘要全部还原，画布 State 同步，Harness 调用始终 0。
- 证据：[UI 计数与源码摘要](P2-TRANSACTION-001-ui-test.json)、[审阅时的页面记录](P2-TRANSACTION-001-review.ax.txt)、[撤销后的页面记录](P2-TRANSACTION-001-undone.ax.txt)。截图 API 返回 Unable to capture screenshot，未伪造截图；视觉与真实桌面仍待乙方补验。

## 接入与验收要求

1. 重载隔离宿主代码及最新前端 dist。既有 API 委托应覆盖新增路由；插件健康说明若仍显示只读需核对，不要绕过事务自写原项目。
2. 在示例副本验证预览／勾选／最终确认三个阶段，前两者不改源码；apply 后重新解析且清除对应草稿；历史可跨重载读取。
3. 核对完整源码对照、逐文件差异、待实现函数提示、浅／深色、小尺寸嵌入和键盘焦点；切换工作区不得显示旧记录或清除另一工作区草稿。
4. 另一编辑器改变源码后，旧 apply／undo 应冲突且保留外部内容；多次应用需按最近顺序撤销。没有自动合并和强制覆盖。
5. 在独立测试进程中补测实际进程终止和文件权限／磁盘错误后的恢复；记录是否全部恢复或 recovery_required。核心测试使用故障钩子模拟，不替代真实桌面崩溃／硬件断电验证。
6. 验证宿主卸载停止 worker、重新加载恢复中断事务；单独提交 integration/P2-TRANSACTION-001.md。

## 已知边界与下一步

跨文件采用日志协调恢复，并非文件系统跨文件原子提交；项目锁不能控制所有外部编辑器，校验与替换之间存在竞争窗口。检测到的外部变化不会强制覆盖。恢复原始字节，不恢复完整 ACL、mtime 等系统元数据。日志最多 200 条／256 MiB，需要用户自行归档，不自动删除历史。

第四步才实现 Harness 节点行为任务、指定临时工作区、状态／取消／结果衔接；第五步为完整桌面验收。当前不能宣称全部项目功能完成。
