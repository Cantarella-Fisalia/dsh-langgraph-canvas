# HARNESS-COMPLETE-001：完整编辑闭环接入验收（乙方）

协议版本：双方协作协议 v1.0（第 10 节：本批行为 adapter 由甲方临时接手实现）。负责方：乙方（Harness 接入与测试）。日期：2026-10-24。
对应甲方交付：[HARNESS-COMPLETE-001](../main/HARNESS-COMPLETE-001.md)。状态：**接入无阻塞，可试用；桌面重启验收待用户执行**。

## 1. 环境与版本

| 项 | 实际值 |
|---|---|
| 插件 | `plugins/harness` **0.3.0**（`lib/index.js` 注入 `behavior-adapter.js`，`ctx.llm` + `agentDefaultModel`） |
| 前端产物 | `apps/frontend/dist`（index.html `561CB4B0…`，bundle `9976DAD3…`） |
| 宿主运行时 | Node 24.21.0（桌面应用内）；系统 node 24.13.0（跑测试用） |
| Python | 3.12.3 `D:/Anaconda/python.exe`（**PATH 上的 python 是 3.7.9，见第 4 节**） |
| 隔离实例 | `DSH_HOME=E:\Heng\vis4agent\.dsh-test`，profile `vis4agent-test`，端口 61999 |
| 桌面 profile | 仍为 `link:` 安装；应用**未重启**，运行的是 10-23 17:20 启动的 0.2.0 宿主 |

## 2. 独立验证结果

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| 1 | 甲方预检（默认 11 项） | **11/11 通过** | `.tmp/acceptance/latest.json` |
| 2 | 甲方预检 + `--harness-url` 指向我的隔离实例（12 项） | **12/12 通过**，含 `live-harness-readiness` | `.tmp/acceptance/harness-url.json` |
| 3 | 插件 adapter 检查 `node --test plugins/harness/tests/behavior-adapter.test.mjs` | **7/7 通过** | 需 `VIS4AGENT_PYTHON`，见第 4 节 |
| 4 | 隔离实例宿主加载 | `v0.3.0`，`stage=behavior-integration`，`backend=ready` | `GET /vis4agent/api/health` |
| 5 | 行为适配器就绪 | `behavior.available=true`，`mode=workspace-task`，跟随默认模型 `deepseek-official/deepseek-flash` | 同上 |
| 6 | 原生界面新工作台 | State 字段、结构编辑页签、节点详情与源码、拓扑图正常渲染 | `docs/evidence/harness-complete-node.png` |

预检与 adapter 检查都涉及真实 Python 子进程与本地 fixture 进程，**必须在非 DSH 沙箱环境执行**（沙箱下 `spawn EPERM`，表现为 500 或测试崩溃）——这是环境限制，不是缺陷。

## 3. 未验证项（如实记录）

1. **真实模型生成 → 审阅 → 应用 → 撤销**：我**没有点击生成**。隔离实例已连上默认模型，触发就会用用户账号发真实请求并产生费用；甲方已用受控替身完成该链路（其记录中明确标注）。真实模型效果待用户试用反馈。
2. **桌面验收**：桌面应用自 10-23 17:20 起未重启，`/vis4agent/api/health` 仍是 `0.2.0 / p1-integration`，因此行为接口在本机桌面跑的是旧宿主，需用户**完全退出并重新打开**。
3. 取消/重载/异常退出后的任务记录恢复：甲方有自动检查覆盖，我未在桌面环境复现。

## 4. 发现（建议归属：接入层/文档）

1. **解释器选择是隐形坑**：`PythonWorker` 默认取 `VIS4AGENT_PYTHON`，否则用 PATH 上的 `python`，本机是 **3.7.9**。不带环境变量跑 adapter 端到端检查会得到 `Cannot read properties of undefined (reading 'graphs')`（其实是 `/projects` 返回 500）。建议：启动时探测解释器版本并给出明确诊断，或把 `D:/Anaconda/python.exe` 写入插件默认值（宿主 `resolvePython()` 目前只在插件侧兜底，`createApplication` 传入的 `pythonCommand` 已覆盖该场景，但**测试脚本**直接调 `createApplication` 时没有兜底）。
2. **桌面必须完全退出**：仅刷新页面不会重新加载宿主代码（Node ESM 模块缓存），本批 `index.js` 与 adapter 都是宿主侧。
3. 前端产物是热更的：`apps/frontend/dist` 更新后刷新页面即可，不必重启应用。

## 5. 结论

接入层没有阻塞项：插件 0.3.0 能在真实 Harness 实例内加载，行为适配器正确报告就绪，甲方预检与 adapter 检查在我这边独立复跑全部通过，原生界面新工作台渲染正常。

剩余为**用户侧试用**：完全退出桌面 → 重新打开 → 配置全局默认模型 → 在「架构」页编辑职责并走一遍确认/审阅/应用/撤销。真实模型行为与业务效果不属于本轮接入验收结论。
