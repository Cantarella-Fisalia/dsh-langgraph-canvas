# P1-READ-001：真实源码读取与图画布

负责方：甲方（主功能开发）。状态：待接入。日期：2026-10-23。
依据：PROJECT_PLAN.md 与双方协作协议 v1.0。

## 交付范围

- apps/frontend：独立 React + React Flow 工作台，项目输入、多图选择、真实节点边、分支/回路、缩放、拖动、自动排布、详情、源码定位、共享状态与诊断。
- apps/backend：Node TypeScript API、Python 工作进程客户端、项目注册、文件监听、SSE 和布局存储。
- services/python-worker：不执行项目的静态解析，支持显式注册、跨文件函数/状态、常见函数作用域、明确条件映射与等待汇合边。
- packages：版本化图协议、运行时返回校验、API 客户端和四类扩展契约。
- extensions：MCP/RAG/Tools/Skills 目录与职责预留；当前未接入。
- examples：research-team、parallel-team、router-team，分别覆盖循环、并行汇合与条件路由。
- 根清单、锁文件、启动脚本、README 和 API 说明。

没有修改 plugins/harness、桌面 profile 或乙方测试目录。本批不含 Python 源码写回、Harness 编码任务或真正的模型执行轨迹。

## 运行与构建

需要 Node 24+、Python 3.11+。本机验证 Node 24.13.0、Python 3.12.3。

```powershell
cd E:/Heng/vis4agent
npm.cmd ci
npm.cmd run dev
# 前端 http://127.0.0.1:5173/；API http://127.0.0.1:4318/api/v1
```

VIS4AGENT_PYTHON 可指定解释器路径。TypeScript 与 Python 源码默认使用无 BOM UTF-8。

```powershell
npm.cmd test
npm.cmd run build
```

依赖实际版本以 package-lock.json 为准，前端产物位于 apps/frontend/dist。生产产物由构建生成，不直接手工修改。

## 接口与乙方接入点

详细说明：[P1_READ_API.md](../../api/P1_READ_API.md)。

1. 宿主导入 apps/backend/src/application.ts 的 createApplication，传入 repoRoot 和 apiPrefix。
2. 将前缀路由交给 application.handler，卸载时调用 application.close。
3. 将 apps/frontend/dist 作为同源静态页面提供，建议用 iframe 在插件工作区挂载。
4. 通过 apiBase 查询参数或 __VIS4AGENT_CONFIG__ 指向 /vis4agent/api/v1。
5. 保留 Harness client/client.js 的 __ModuleLoader__ 包装，不能直接用 Vite 页面替换这个入口文件。
6. 在桌面环境验证解释器、工作目录、同源鉴权、SSE、静态资源和生命周期。

这些是已交付的核心边界与建议挂载方案，尚未由乙方在桌面端确认。P0 健康页和内置示例不会自动升级为新工作台。

## 开发侧验证

- 自动检查：2 项后端/API 检查及 9 项 Python 解析检查；TypeScript 检查与生产构建。
- 场景：真实跨文件示例、普通/条件/汇合边、动态诊断、绝不执行用户模块、源码读取限制、外部修改与布局冲突、损坏布局不覆盖。
- 独立本地页面：通过 UI 打开真实 research-team 项目，发现 1 图、3 业务节点与 5 条边；选择 writer 显示 nodes.py 6–8 行、函数说明和 5 个状态字段。
- 通过 UI 拖动 writer、保存布局，重新打开项目后恢复；API 检查确认 Python 源码字节未变。
- 页面证据：同目录 p1-workbench.png（独立前端截图，不是 Harness 桌面验收截图）。

最终项目目录中的检查结果以本批交付结束时的验证记录为准。未验证：桌面内挂载、真实模型调用、宿主更新后的兼容性、多用户协作。

## 乙方验收清单

1. 在隔离环境按锁文件安装并构建；确认 Python 路径。
2. 在 Harness 内挂载实际前端，打开 examples/research-team 的绝对目录。
3. 检查 3 个业务节点、START/END、审核回路与结束分支。
4. 点击 writer，核对跨文件函数、行号、状态及源码。
5. 拖动保存，重开项目确认位置恢复；对比业务 Python 文件未变。
6. 修改节点名及对应连线，确认监听或手动刷新更新实际图。
7. 检查 parallel-team 的等待汇合、router-team 的条件选路。
8. 对动态路由、Python 语法错误、无图项目、无效目录验证明确诊断。
9. 检查旧布局冲突、无效布局文件，以及插件卸载后 watcher/SSE/worker 清理。
10. 在 docs/handoffs/integration/P1-READ-001.md 记录结果与证据。

## 已知限制与决策

- P1 采用标准库 AST 只读分析；P2 源码改写引入 LibCST。不会以 AST 重写业务源码。
- 自动排布为确定性分层布局，未引入 ELK；复杂图布局后续改善。
- 项目内存注册，服务重启需重新打开；布局持久化。
- 不能完整恢复动态工厂、跨函数构建器传递、任意重赋值、全部导入属性及继承状态；动态控制流仅诊断。
- 不支持路径映射缺失时推断任意路由目的地，不冒充完整图。
- 文件扫描最多 500 个 .py、单文件 2 MiB；隐藏目录与常见依赖目录忽略。
- 没有源码变更事务、代码生成或运行调试能力，相关入口未伪装可用。

## 最终目标目录验证

2026-10-23 在 E:/Heng/vis4agent 中执行：npm ci 成功；npm test 共 11 项（2 项后端/API、9 项 Python）全部通过；npm run build 包含 TypeScript 检查与 Vite 生产构建，退出码 0。

Windows 曾阻止 esbuild 清理系统 TEMP 文件，已新增 scripts/build/frontend.mjs，为本次构建创建项目内隔离临时目录并在结束时清理；生产构建已通过。React Flow 的 use client 指令产生非阻塞打包提示，不影响此次构建完成。

独立工作台预览已完成，开发验证服务在交付结束时关闭；使用 npm run dev 可自行重新启动。Harness 桌面内的新工作台挂载与验收仍待乙方完成。
