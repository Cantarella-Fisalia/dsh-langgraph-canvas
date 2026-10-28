# P1-READ-001：接入与验收记录（乙方）

协议版本：双方协作协议 v1.0。负责方：乙方（Harness 接入与测试）。日期：2026-10-23。
对应甲方交付：[P1-READ-001](../main/P1-READ-001.md)。状态：**接入完成，隔离环境验收通过；桌面版需重启后确认**。

## 1. 接入版本与环境

| 项 | 实际值 |
|---|---|
| 甲方产物 | `apps/frontend/dist`（index.html `D33BC1B8109B4857`，bundle `036EE4358A989175` 前 16 位） |
| 接入包 | `plugins/harness` v0.2.0（lib `AA65D9516316DE08`，client `535120BF7F4428D0`） |
| Harness | 桌面版 0.2.0-rc.2，Electron 43.3.0，应用内 `@deepseek-ai/*` 0.2.1-rc.2 |
| Node（宿主运行时） | 24.21.0（类型剥离可用，已实测 import `.ts` 成功） |
| Python | 3.12.3，`D:/Anaconda/python.exe` |
| 验收 profile | 隔离 `E:\Heng\vis4agent\.dsh-test\profiles\langcontour-test`（不动 desktop） |
| 桌面安装 | `link:E:/Heng/vis4agent/plugins/harness` + 目录联结（沿用 P0，见 PROJECT_PLAN 14.3） |

## 2. 挂载方式（接入层实现）

- 宿主路由前缀 `/langcontour`，内部分流：
  - `/langcontour/app/**` → `apps/frontend/dist` 静态产物（同源，SPA 兜底 index.html，路径越界 403）
  - `/langcontour/api/v1/**` → 甲方 `createApplication({ repoRoot, pythonCommand, apiPrefix })` 的 `handler`
  - `/langcontour/api/health` → 接入层诊断（保留 P0 路由，便于确认加载）
- 浏览器半侧：`settings.section` 提供状态卡片与入口，`shell.overlay` + `createPortal(document.body)` 提供全屏 iframe 工作台（`?apiBase=/langcontour/api/v1`），不用 Vite 产物替换 `client/client.js`。
- 生命周期：`ctx.effect` 返回 disposer，调用 `application.close()`。
- 关键实现约束（已踩坑）：
  - 插件经 pnpm 联结加载时 `import.meta.url` 停在 profile 的 `node_modules` 下，**必须 `realpathSync.native`** 解链（普通 `realpathSync` 解不开 pnpm 联结），否则静态目录与后端入口都会指错。
  - `shell.overlay` 层级低于设置弹窗，工作台必须 portal 到 `document.body`。

## 3. 验收项结果

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 不执行用户项目即可读取图 | 通过 | `examples/research-team` 解析出 3 业务节点 / 5 边 / 扫描 3 个 `.py`；源码越界读取返回 400 |
| 2 | 在 Harness 内挂载实际前端，打开真实目录 | 通过 | 设置 → LangGraph 工作台 → 全屏 iframe；见 `docs/evidence/p1-dsh-workspace.png` |
| 3 | 3 个业务节点 + START/END + 审核回路 + 结束分支 | 通过 | `nodes=[research,writer,reviewer,__start__,__end__]`，`edges=normal×3 + conditional×2`；见 `p1-dsh-canvas.png` |
| 4 | 点击 writer 核对跨文件函数、行号、状态 | 通过（API） | `writer` → `nodes.py` 6–8 行，`functionRef=writer`，`TeamState` 5 个字段 |
| 5 | 拖动保存、重开恢复、Python 源码不变 | 部分 | API 层通过：保存后读回 `x=420`，`nodes.py` SHA256 前后一致；**拖拽 UI 未实际执行** |
| 6 | 改源码后图更新 | 通过（API） | 把 `reviewer` 全部改为 `checker` 后 `GET /graphs` 立即返回 `checker`；**未走 UI 刷新按钮** |
| 7 | parallel-team 等待汇合 / router-team 条件选路 | 通过 | 汇合边 2 条，`joinId=graph.py::builder:join:31`；条件边 2 条，标签 `support/research` |
| 8 | 动态写法 / 语法错误 / 无图 / 无效目录的诊断 | 通过 | 语法错误返回 `SYNTAX_ERROR (graph.py:2)`；空项目 0 图 0 诊断；无效目录 `INVALID_ROOT` 400 |
| 9 | 旧布局冲突、无效布局、卸载清理 | 通过 | 过期 `baseRevision` → 409 `LAYOUT_CONFLICT`；卸载后 Python 进程 1→0、SSE 关闭、接口 503 `CLOSED` |
| 10 | 本记录 | 通过 | 本文件 |

自动检查 12 项全部通过（见第 4 节脚本）。

## 4. 复现方式

```powershell
# 1) 隔离实例（插件需启动 Python，受限沙箱会 spawn EPERM，须在非沙箱环境跑）
$env:DSH_HOME = 'E:\Heng\vis4agent\.dsh-test'
dsh --profile langcontour-test --no-open --port 61999
# 打开启动日志里的 http://127.0.0.1:61999/?token=... → 设置 → LangGraph 工作台 → 打开工作台

# 2) 接口级验收（真实 http.Server + 真实 Python）
node .tmp\accept-p1.mjs      # 12/12 PASS
node .tmp\cleanup-p1.mjs     # 卸载清理
node .tmp\verify-p1.mjs      # 路由/静态/健康检查
```

`.tmp/` 为临时脚本，不纳入交付；如需保留可迁移到 `scripts/test/`。

## 5. 问题与限制

1. **桌面版尚未重启验收**：desktop profile 已 link 到 v0.2.0，但当前运行中的桌面应用是 16:35 启动的 0.1.0 宿主，`/langcontour/app` 路由不存在。需重启一次应用；重启后应看到「宿主插件 0.2.0 · 后端已挂载」。
2. 工作台目前从设置页进入；后续可改为侧边栏主面板（需接入宿主导航服务），不影响本批验收。
3. Python 解释器优先级为 `LANGCONTOUR_PYTHON` → `D:/Anaconda/python.exe` → `python`。目标机若不同需设环境变量；桌面版不继承终端环境，必要时把解释器路径写进配置（待与甲方确定配置位）。
4. 前端未验证：拖拽保存的真实交互、Last-Event-ID 断线续传、多窗口并发编辑布局。
5. 未验证：桌面版真实的 SSE 长连接稳定性（隔离实例已连上并收到事件）。

## 6. 结论

接入层完成，甲方 P1 产物在 Harness 内可正常加载与交互，读取链路、诊断、布局与卸载清理均按验收项通过。阻塞项只有一项：**桌面版重启**（属用户侧操作，接入层无法自动重启宿主）。建议归属：接入层无待修缺陷；剩余项为环境确认与 UI 交互补充验证。
