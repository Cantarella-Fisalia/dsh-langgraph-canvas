# P3-BEHAVIOR-001：节点行为任务流程

日期：2026-10-24。负责：甲方。状态：**待接入**（甲方第四步主功能完成；真实宿主 adapter 尚未实现／注入，整体第四步未验收）。
范围：第四步主功能；持久任务、受控临时源码副本、adapter 契约、状态与取消、静态验收及源码事务审阅。涉及 apps、packages、Python worker、测试和文档。依赖 P2-TRANSACTION-001。Harness 实际适配由乙方实现；本批不改插件文件、profile 或乙方证据，不伪造真实宿主执行。

## 主功能交付

- 正式 HarnessBehaviorAdapter 契约：submit／getStatus／cancel；由 ApplicationOptions.behaviorTaskAdapter 注入。旧 editRequestAdapter 保留意图接收兼容，前端不再把它当作编码执行通道。
- 确定版本的源码事务作为行为模板：节点职责、跨文件函数、State、新节点占位、条件路由分支键及共享函数影响。空白新节点职责会要求先填写，不生成无依据的假实现。
- 持久行为任务和自有 Python-only 临时副本；先落盘再请求宿主，稳定幂等键；回执丢失／超时／重启只查询已有任务，不自动重发。
- UI 新增“行为任务”，支持状态查询、明确确认取消、失败／取消后重新确认新尝试。取消只有获停止确认才结束，迟到成功不导入。
- 静态检查目标函数体、签名、其他代码、导入绑定、图结构和源码版本；通过后生成 kind:behavior 的第三步待应用事务，不自动写回原项目。支持确认应用及撤销，originRequestId 用于正确清理原草稿。
- 缺 adapter 时诚实禁用；插件本轮未接上真实宿主，测试 adapter 仅在 .tmp 和测试文件中，未进入插件。

完整输入输出、错误、限制、注入方法与生命周期：[P3_BEHAVIOR_TASKS_API](../../api/P3_BEHAVIOR_TASKS_API.md)。这是本批正式接入端口，不是对宿主官方 API 名称的推测。

## 文件与依赖

新增：packages/contracts/src/behavior.ts、apps/backend/src/behavior-tasks.ts 及 test、apps/frontend/src/behavior.tsx、Python behavior.py 及 test_behavior.py、P3 API 与本批交接／证据。

修改：backend/application.ts、frontend/App.tsx／editor.tsx／transactions.tsx／styles.css、contracts/index.ts／source-preview.ts、api-client/index.ts、Python __main__.py／transactions.py、package.json 测试入口、PROJECT_PLAN／README／DEVELOPMENT_HANDOFF／旧 P2 草稿 API 增量说明。dist 通过生产构建生成。

无新增 npm／Python 依赖；没有修改 plugins/harness、profile、示例源码、锁文件或乙方验收记录。MCP/RAG/Tools/Skills 仍保留原接口，本轮未接入。

## 检查和证据

Node 24.13.0、Python 3.12.3、Vite 7.3.7。`npm.cmd test`：54 项通过（20 Node + 34 Python）；`npm.cmd run build`：类型与生产构建通过，React Flow 原有 use client 提示保留。

覆盖：默认未配置、明确确认、仅副本写入、持久幂等、回执丢失查询、RPC 超时不重发、跨重启读取、取消等待确认与迟到成功、结果差异审阅／应用／撤销、BOM／CRLF、跨文件职责、prepared／applied 两类模板、新节点占位、布尔／整数分支上下文、未授权文件／图／State／签名／其他函数／导入绑定／新增文件拒绝、仅文档改动拒绝、未实现占位及非法 await 拒绝、外部源码冲突。检查不运行或 import 用户模块，也不证明业务语义正确。

隔离生产 UI 使用**明确标注的合成 adapter**，改 research 节点职责为将 topic 大写写入 research_notes：

1. 编辑职责和生成预览：submit=0，apply=0，确认按钮勾选前禁用。
2. 明确确认：synthetic submit=1，展示运行状态与 synthetic-ui-1 宿主编号，仅副本发生变化。
3. 合成任务完成：静态验收生成 nodes.py 待审阅差异，原项目三文件摘要仍不变，确认应用按钮勾选前禁用。
4. 再明确确认应用：只 nodes.py 改变；确认撤销后三文件 SHA-256 全部恢复。最终 submit=1／apply=1／undo=1。

证据：[UI 计数与摘要](P3-BEHAVIOR-001-ui-test.json)、[提交门禁 AX](P3-BEHAVIOR-001-confirm.ax.txt)、[生成结果 AX](P3-BEHAVIOR-001-result.ax.txt)。截图接口返回无法捕获，未伪造截图；真实视觉与桌面验收需乙方补充。没有实际模型 API 调用或真实 Harness 任务，不能将此结果写成宿主通过。

## 乙方接入动作

1. 阅读正式端口，核实当前桌面版本的真实任务 API，在乙方维护范围记录 adapter 路径和版本，然后实现并注入 behaviorTaskAdapter。不要注入测试 adapter，不用旧意图端口直接执行。
2. 证明宿主实际 cwd 为 assignment.workingDirectory，并通过权限／工具策略限制写入。原项目不作为编码工作目录；不运行用户项目，不复制依赖、数据或配置秘密。
3. 持久化 idempotencyKey→hostTaskId，支持没有 hostTaskId 时查询既有任务。提交超时后禁止第二次执行；若实际 API 不支持找回，需要如实返回 unknown，不伪造成功。
4. 核实成功／失败／取消确实停止写副本；取消确认前不能声明已取消。记录卸载时真实宿主任务是否继续，重载后只查询，不自动重发。
5. 使用真实模型修改已有节点、新节点占位和路由，验证结果静态验收、原项目不自动修改、独立审阅确认应用、撤销与外部冲突。
6. 补验浅／深色、嵌入尺寸、工作区切换、任务历史、断开与恢复、取消和重复点击，单独提交 integration/P3-BEHAVIOR-001.md。第五步桌面完整验收仍待执行。

## 限制与恢复

临时副本仅 Python 静态源码，不是可运行全项目；只允许目标函数体／docstring 和不覆盖现有绑定的新模块导入，不支持修改函数签名、模块级新 helper、依赖清单、State 或构图。改变这些需求应回到结构编辑或另行明确设计。

编译与 AST／图检查不执行代码、不安装依赖，不保证模型业务逻辑、动态占位或导入在运行环境可用。失败、冲突或未知回执保留临时副本供定位；已停止且成功／取消的副本可在所有权检查后清理。任务 JSON 含本地源码快照，最多 100 条／256 MiB、3 个未结束任务，旧记录由用户自行归档。

当前插件未配置新 adapter，默认节点行为确认按钮禁用。后续不能把“甲方主功能已完成”写成“整体第四步或全部项目已完成”。
