# UI-EMBED-001：原生视图接入验收（乙方）

协议版本：双方协作协议 v1.0。负责方：乙方（Harness 接入与测试）。日期：2026-10-23。
对应甲方交付：[UI-EMBED-001](../main/UI-EMBED-001.md)。桥接契约：[HARNESS_VIEW_BRIDGE](../../api/HARNESS_VIEW_BRIDGE.md)。
状态：**补验通过（有 2 项限制）**。不覆盖 [P1-READ-001](P1-READ-001.md)。

## 1. 环境与版本

| 项 | 实际值 |
|---|---|
| 客户端 bundle | `plugins/harness/client/client.js` 18:03 版（甲方授权修改，`conversation.view` 原生页签 + postMessage 桥） |
| 宿主半侧 | `plugins/harness/lib/index.js` v0.2.0（本轮未改，仍提供 `/dsh-langgraph-canvas/app` 与 `/dsh-langgraph-canvas/api/v1`） |
| 前端产物 | `apps/frontend/dist`（18:03 重建） |
| Harness | 桌面版 0.2.0-rc.2；隔离实例端口 61999 |
| Node / Python | 24.21.0 / 3.12.3（`D:/Anaconda/python.exe`） |
| 测试工作区 | 隔离 profile 内预置两个真实工作区：`examples/research-team`、`examples/router-team` |

## 2. 补验结果

| # | 补验项 | 结果 | 说明 |
|---|---|---|---|
| 1 | 空白会话顶部「◇ 架构」入口 | 通过 | 点击后主区域切换为架构视图；见 `ui-embed-research.png` |
| 2 | 有消息会话的「架构」页签 | **未执行** | 隔离实例无模型/API Key，无法产生消息；页签路径未点击 |
| 3 | 两个实际项目的目录切换 | 通过 | 在 `router-team` 工作区新建会话后，iframe 自动切到 `E:\Heng\vis4agent\examples\router-team`，解析出 `classify / support / research` 与 `support|research` 条件边；`research-team` 侧为 `research / writer / reviewer` + revise 回路 |
| 4 | 自动读取目录、无输入框 | 通过 | 嵌入模式不再出现独立目录输入；目录由会话工作区传入，空工作区时传 null 并清空旧结果 |
| 5 | 浅色 / 深色可读性 | 通过 | 宿主切换外观后 iframe 主题 token 跟随；见 `ui-embed-light.png` / `ui-embed-dark.png` |
| 6 | 布局保存 | **部分** | 界面显示「布局已保存」，但 `examples/*/.vislang` 为空，说明本轮没有真正落盘；API 层保存与 409 冲突已在 P1-READ-001 验证 |
| 7 | SSE 清理 | 继承验证 | 后端卸载清理（worker 1→0、SSE 关闭、503 CLOSED）见 P1-READ-001；本轮未单独测 iframe 卸载时的连接回收 |
| 8 | 诊断与只读 | 通过 | 空目录显示「未发现可解析的图 / 0 个文件已扫描」，不伪造空图 |

## 3. 证据

- `docs/evidence/ui-embed-research.png`：原生视图 + research-team 三节点画布（深色）
- `docs/evidence/ui-embed-router.png`：切到 router-team 后自动换目录
- `docs/evidence/ui-embed-light.png`：浅色主题
- `docs/evidence/ui-embed-dark.png`：深色主题 + 侧边栏工作区

> 截图中「开始使用」登录浮层与插件无关：隔离实例未配置 API Key。

## 4. 复现步骤

```powershell
$env:DSH_HOME = 'E:\Heng\vis4agent\.dsh-test'
dsh --profile dsh-langgraph-canvas-test --no-open --port 61999
# 打开日志里的 token 地址：
#   空白会话 → 顶部「◇ 架构」
#   侧边栏工作区行右侧按钮「在 <workspace> 中新建会话」→ 顶部「◇ 架构」
```

`storages/workspace.json` 需预置工作区（本轮用 research-team / router-team 两条），否则目录为默认空目录。

## 5. 发现与建议（归属：接入层无缺陷，属使用与验证边界）

1. **多工作区切换只能通过工作区行的「新建会话」按钮**：直接点工作区名称不会切换当前工作区，容易误以为没有切换——建议甲方在侧边栏行上补一个明确的"切换到此工作区"交互或提示。
2. 有消息会话的页签路径未验证（缺模型凭据），建议在配好 API Key 的桌面环境补一次。
3. 布局落盘在 UI 侧未观察到（`.vislang` 为空），建议甲方确认"布局已保存"标签是否只在拖动后触发保存。
4. 主题桥按 body 计算样式复制 `--dsw-*`/`--dsh-font-*`/`--ds-font-*` 变量，实测浅色/深色均生效。

## 6. 结论

原生视图具备可用性：入口、自动读取工作区、目录切换、主题跟随与只读诊断均符合交付说明；页签路径与布局落盘两项未取得证据，不作为通过项。接入层未发现需要修改的代码；`plugins/harness/lib/index.js` 与桌面 profile 本轮未改动。
