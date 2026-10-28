# vis4agent Harness 插件 v0.3.0

本地桌面插件，宿主路由、原生架构视图、工作区／主题桥接及真实行为生成 adapter 已接通。先看 [使用与首轮测试指南](../../USER_GUIDE.md)。本机原有 link 安装继续生效，宿主改动需要完全退出并重新打开桌面。

宿主入口 lib/index.js 只要求 webServer，模型服务通过 ctx.get 可选读取；未配置模型不影响结构读取与源码事务。行为实现位于 lib/behavior-adapter.js，经 lib/session-channel.js 提交真实当前会话回合，沿用会话上下文与模型；每个插件回合临时禁用工具，回合结束恢复普通会话；生成结果仅写受限临时副本，独立确认事务才写原项目。

本批无需新的依赖、GitHub 或桌面 profile 修改。回执在仓库 .vislang/harness-tasks，不属于源码。卸载插件会停止本适配器生成任务，重载不会自动再次执行。

详细契约：[P3 行为 API](../../docs/api/P3_BEHAVIOR_TASKS_API.md)。下文保留早期安装说明；功能和状态以使用指南与本段为准。

# vis4agent —— Harness 插件（P1 接入版）

把甲方（主功能开发）交付的独立前后端接进 DeepSeek Harness：`apps/frontend/dist` 作为同源 iframe 工作台，`apps/backend` 的 `createApplication` 挂到宿主路由前缀下。

> 归属：本目录归乙方（Harness 接入与测试）。业务界面与解析逻辑在 `apps/`、`services/`、`packages/`，由甲方维护，接入层不修改它们。

## 目录

```text
plugins/harness/
├─ package.json        # dsh.bundle（patch 层）+ dsh.client（浏览器半侧）
├─ cordis.patch.yml    # 安装后自动叠加的配置层
├─ dev.patch.yml       # 本地开发用的绝对路径 overlay（可选）
├─ lib/index.js        # 宿主半侧：静态挂载 + API 挂载 + 生命周期
└─ client/client.js    # 浏览器半侧：原生架构视图 + 空白会话顶部入口 + 主题／目录桥接
```

## 路由

| 路由 | 作用 |
|---|---|
| `/vis4agent/app/**` | `apps/frontend/dist` 静态产物（同源，SPA 兜底，路径越界 403） |
| `/vis4agent/api/v1/**` | 甲方 `createApplication` 的 handler（项目、图、源码、布局、SSE） |
| `/vis4agent/api/health` | 接入层诊断：插件版本、仓库根、Python 命令、后端是否已挂载 |

## 加载方式

### 装进独立 profile（验收用，含浏览器半侧）

```powershell
$env:DSH_HOME = 'E:\Heng\vis4agent\.dsh-test'
dsh --profile vis4agent-test --from-default-profile web --dump-config   # 首次创建
dsh plugin --profile vis4agent-test add "E:/Heng/vis4agent/plugins/harness"
dsh --profile vis4agent-test --no-open --port 61999
```

打开启动日志给的带 token 地址，在会话的 **对话／轨迹** 旁选择 **架构**；空白会话点击顶部 **◇ 架构**。项目目录自动跟随当前工作区，无需重复输入。设置中的 **LangGraph 架构** 仅用于查看服务状态。

> 插件会启动 Python 工作进程。DSH 沙箱会以 `spawn EPERM` 阻止带管道的子进程，验收必须在非沙箱环境（桌面应用或放开权限的终端）里跑。

### 只叠加宿主半侧（改代码后快速验证）

```powershell
dsh --profile <name> --patch "E:/Heng/vis4agent/plugins/harness/dev.patch.yml"
```

### 桌面版

桌面 profile 由应用独占，用 `link:` + 目录联结安装（见 `PROJECT_PLAN.md` 14.3）。宿主代码改动需要重启应用，浏览器半侧保存即热更。

## Python 解释器

优先级：`VIS4AGENT_PYTHON` 环境变量 → `D:/Anaconda/python.exe` → `PATH` 上的 `python`。
桌面应用不继承终端环境，换机器时需要改这个默认值或注入环境变量。

## 四个容易踩的坑

1. **`import.meta.url` 会停在 profile 的 `node_modules` 下**（pnpm 联结）。仓库根必须用 `realpathSync.native` 解链——普通 `realpathSync` 解不开 pnpm 建的联结，会静默指到 profile 目录。
2. **空白会话会隐藏 conversation.view 页签**，因此同时提供 conversation.header.leading 入口并通过 layout.selectPanel 打开 main 插槽；不再注册 shell.overlay 或使用 portal。
3. **客户端不要用 `jsx(type, props, children)`**：`react/jsx-runtime` 的第三个参数是 `key`，误传 children 会静默渲染空白；用 `React.createElement`。
4. **`dsh --profile <name>` 后面不要再写 `web`**，会被当成多余的 app 参数报 `too many arguments`。

## 本轮原生视图变更

UI-EMBED-001 按用户明确要求由甲方修改浏览器接入文件；宿主路由和桌面 profile 沿用乙方实现。后续接入维护仍归乙方。桥接说明见 [HARNESS_VIEW_BRIDGE](../../docs/api/HARNESS_VIEW_BRIDGE.md)，本轮结果见 [UI-EMBED-001](../../docs/handoffs/main/UI-EMBED-001.md)。

## 验证记录

- 接入验收：[docs/handoffs/integration/P1-READ-001.md](../../docs/handoffs/integration/P1-READ-001.md)（12 项自动检查 + 卸载清理 + 桌面截图）
- P0 基线：`PROJECT_PLAN.md` 第 14 节
