# PYTHON-RUNTIME-001：解释器一致性修复复验（乙方）

协议版本：双方协作协议 v1.0。负责方：乙方。日期：2026-10-24。
对应甲方交付：[PYTHON-RUNTIME-001](../main/PYTHON-RUNTIME-001.md)。起因：[HARNESS-COMPLETE-001 验收](HARNESS-COMPLETE-001.md) 第 4 节第 1 条。
状态：**问题已修复，无回归**。

## 1. 复现条件（与上次报告一致）

- PATH 首位临时加入 `C:\Users\31675\AppData\Local\Programs\Python\Python37-32`，`python --version` 为 **3.7.9**；
- 清空 `DSH_LANGGRAPH_CANVAS_PYTHON`；
- 系统中另存 `D:/Anaconda/python.exe`（3.12.3）。

## 2. 结果

| # | 检查 | 上次 | 本次 | 说明 |
|---|---|---|---|---|
| 1 | `node --test plugins/harness/tests/behavior-adapter.test.mjs`（不设环境变量） | 1 项失败：`Cannot read properties of undefined (reading 'graphs')` | **7/7 通过** | 自动选中 3.12，直接 `createApplication` 也有统一兜底 |
| 2 | 不设环境变量打开真实项目 | — | **200**，解析 1 图 / 5 节点 | `auto graphs = 1` |
| 3 | 显式 `pythonCommand` 指向 3.7.9 | — | **503 `PYTHON_VERSION_UNSUPPORTED`** | 消息含实际路径、版本 3.7.9、需要 3.11+ 与设置指引 |
| 4 | `DSH_LANGGRAPH_CANVAS_PYTHON` 指向 3.7.9 | — | **503 `PYTHON_VERSION_UNSUPPORTED`** | 同上，不静默回退 |
| 5 | 预检（默认 11 项） | 11/11 | **11/11** | 无回归 |
| 6 | 预检 + `--harness-url`（12 项） | 12/12 | **12/12** | 含 `live-harness-readiness` |
| 7 | 隔离实例加载 | 0.3.0 | **0.3.0 / behavior-integration / backend ready** | 新宿主 17:16 版 |
| 8 | 隔离实例真实项目 | 5 节点 | **200，1 图 / 5 节点** | 走真实 Python 3.12 |

预检与 adapter 检查均需真实 Python 与本地 fixture 进程，在 DSH 沙箱下会 `spawn EPERM`，须在非沙箱环境执行（环境限制，非缺陷）。

## 3. 观察

1. 错误从"模糊的 500 + undefined.graphs"变成"明确的 503 + 版本号 + 修复指引"，正是上次建议的方向；诊断信息可以直接指导用户改 `DSH_LANGGRAPH_CANVAS_PYTHON`。
2. `scripts/runtime/python.mjs` 用 `-I -S` 探测版本，不加载用户项目与 sitecustomize，符合只读约束。
3. 解释器解析顺序（显式 → 环境变量 → 已知 3.12 → PATH）在插件与直接 `createApplication` 两条路径上一致，杜绝了"宿主能跑、测试跑不了"的分裂。

## 4. 仍未验证（不变）

1. **桌面应用**：仍是 10-23 17:20 启动的 0.2.0 宿主（`/dsh-langgraph-canvas/api/health` 返回 `0.2.0 / p1-integration`），**需完全退出重开**才能加载 0.3.0 与本修复。
2. **真实模型生成/审阅/应用/撤销**：仍未由我触发（会用用户账号产生真实请求）；甲方用受控替身覆盖。

## 5. 结论

乙方上次报告的解释器一致性问题已修复并通过独立复验，预检、adapter 检查与隔离实例运行均无回归。剩余为桌面重启后的用户试用，不属于接入层待办。
