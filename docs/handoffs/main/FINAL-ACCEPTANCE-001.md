# FINAL-ACCEPTANCE-001：第五步验收预检交付

日期：2026-10-24。负责方：甲方（主功能）。状态：待接入，未验收通过。主计划版本：0.15。

## 目标、范围与结论

用户要求进行五步路线中的最后一步“桌面完整验收”。本批完成甲方范围的回归检查、可复跑的插件模块预检、原始报告和真实桌面验收矩阵。未更改 plugins/harness、adapter、用户桌面 profile 或乙方验收记录，也未提交真实模型任务。任务写入范围已于实施前登记。

当前实际宿主插件仍未注入 behaviorTaskAdapter，integration 目录只有历史 P1-READ-001 与 UI-EMBED-001，暂无 P2/P3 真实任务及桌面闭环记录。因此第五步和整个路线均不能标为验收通过；本批预检不替代乙方实际接入。

## 改动与复跑

- `scripts/acceptance/preflight.mjs`：实际插件模块 + 最小 webServer/effect 上下文；随机本地端口，真实后端及 Python worker，真实生产资源。所有源码修改只发生在自有临时项目副本，结束清理。读取能力接口，不调用模型。
- `package.json`：新增 `acceptance:preflight`，没有新依赖或锁文件变更。
- `docs/acceptance/DESKTOP_ACCEPTANCE.md`：复跑方式、退出码和 D01–D12 桌面清单，明确定义通过条件。
- 主计划、README、开发交接：同步第五步的实际进度与缺失前置条件。
- 本记录与 [原始预检报告](FINAL-ACCEPTANCE-001.preflight.json)。

在 E:/Heng/vis4agent 执行：

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run acceptance:preflight
```

默认报告 `.tmp/acceptance/latest.json`；`-- --report <path>` 指定路径。退出码 0 为预检通过，1 为检查失败，2 为缺少行为 adapter；0 仍不等于桌面验收通过。

## 本轮验证证据

Node 24.13.0、Python 3.12.3；54 项回归检查全部通过（20 Node + 34 Python）。类型检查及 Vite 生产构建通过；React Flow 原有 use-client/sourcemap 警告仍存在，构建成功。当前资源为 index-D7I5k8nc.js、index-AePIcNiv.css，与实际 E 盘产物一致，完整 SHA256 已记入 JSON。

预检通过 11 项：

1. 实际插件注册及两项 effect。
2. 生产 HTML、JS/CSS GET 与摘要一致、HEAD、缺失资源 404。
3. 同源 API 前缀、桌面 origin 接受、非信任 origin 拒绝。
4. 三个真实 Python 示例的副本：循环／汇合／路由，每图 3 个函数节点、2 个边界节点，State 可识别。
5. 经插件路由建立真实 SSE 并收到事件。
6. 布局落盘与旧版本冲突；布局不改 Python、源码路径限制生效。
7. 未确认不能生成；确认预览仍不改原源码。
8. 未确认／错误审阅摘要不能应用；确认后只改 state.py，图重新解析反映新字段；外部修改阻止撤销且字节不变；移除本测试自身改动后确认撤销恢复三文件字节，历史状态为 undone。
9. 真实能力查询为未接入，返回 HARNESS_NOT_CONNECTED；无任务生成，原源码保持不变。
10. 调用插件生命周期清理后 SSE 结束，后端 503 CLOSED，注销后路由 404。
11. E 盘三个原示例的 Python SHA256 始终不变。自有临时目录清理成功。

报告真实结论：`preflight:blocked`、`acceptance:not_accepted`、`realHarnessConnected:false`、`desktopAcceptance:not_performed`；退出码 2 是前置条件未齐，不是上述 11 项失败。没有模拟 Harness adapter，也没有实际宿主服务／Electron 自动化。本轮没有新桌面截图；没有独立观察 OS worker PID 退出，不能据 SSE 关闭宣称进程已清理，交 D12 实测。

## 乙方接续

1. 按 [正式行为任务契约](../../api/P3_BEHAVIOR_TASKS_API.md) 登记并实现真实适配，注入 ApplicationOptions.behaviorTaskAdapter，提供临时 cwd 限制、幂等状态与停止取消的证据。
2. 重新加载被测实例的宿主代码与最新产物，复跑预检，保留报告。
3. 按 [D01–D12 清单](../../acceptance/DESKTOP_ACCEPTANCE.md) 在实际桌面执行；新增 `docs/handoffs/integration/FINAL-ACCEPTANCE-001.md`，明确真实模型任务及每个场景的结果。
4. 发现核心问题交甲方修复，接入问题由乙方修复；完成后复测并据证据更新主计划。

后续 MCP/RAG/Tools/Skills、全项目结构与运行时追踪不在本批验收范围，继续预留。
