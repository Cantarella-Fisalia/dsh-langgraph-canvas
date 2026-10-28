# P2-SOURCE-001：结构到临时源码预览

日期：2026-10-24。负责：甲方（主功能）。状态：**待接入**（第二步主功能完成，真实桌面待乙方验收）。

范围：第二步；不实现原项目应用、撤销或 Harness 行为生成。
文件范围：Python worker 源码转换与测试、backend 预览协调与 API、contracts / api-client、frontend 确认预览及文档。Harness 插槽与桌面 profile 不改。
依赖：P2-DRAFT-001；沿用当前工作区与主题桥。

实现选择：本轮采用 AST 定位 + 字符级精确片段替换，保留未修改字节、编码和换行；不对整文件 ast.unparse。复杂写法保守拒绝，后续扩大支持范围时再引入计划中的 LibCST。

## 实现与接口

- Python `source_preview.py`：节点注册新增／移除／action 替换，普通边、条件整组、等待汇合整组、跨文件 State 字段增删及注解修改；保留业务函数、未改源码和注释。
- 新函数生成明确的 NotImplementedError 占位，描述变化输出 behaviorRequirements，既有函数体及 docstring 保留。路由行为不自动编造。
- 新增 `POST /projects/{id}/source-previews`，沿用 ConfirmEditRequest 的明确 confirmed:true；响应 SourcePreview，包含文件前后文本与字节摘要。原 edit-requests 不变，预览不会调用 Harness adapter。
- 后端检查当前源码版本、草稿及请求 ID，静态转换前后再次检查版本；临时副本自动清理，后端限量缓存返回文本。无原项目应用／撤销接口。
- 前端新增“确认并生成源码预览”，成功后显示文件选择和原始／生成源码对照、占位函数及后续检查提示。编辑、打开清单和重载均不自动生成。

协议、支持范围、限制、错误、生命周期和调用样例见 [P2_SOURCE_PREVIEW_API](../../api/P2_SOURCE_PREVIEW_API.md)。schemaVersion:1；兼容已有桥接与草稿请求接口；无新依赖或安装步骤。

## 实际输入输出

独立 UI 打开 research-team 的三文件副本，编辑 TeamState 增加 `summary: str`，确认生成：仅 `state.py` 返回变更，在 TeamState 中增加 `summary: str`；`graph.py`、`nodes.py` 不变。生成时在 Python-only 临时目录重新解析，State 字段与目标一致；原三文件 SHA-256 不变。

新增节点示例：为节点 review 指定新函数 review 及职责并连入流程，生成 `def review(state): ... raise NotImplementedError(...)`、`builder.add_node("review", review)` 与目标连线。占位并非业务实现，第四步才调用 Harness 实现行为。

## 基本验证

环境：Node 24.13.0、Python 3.12.3、Vite 7.3.7。执行 `npm.cmd test`、`npm.cmd run build`。

- 34 项通过：14 项 Node 检查 + 20 项 Python 检查。覆盖确认、版本、重复并发请求、不调用 adapter、动态／共享 State 拒绝、跨文件 State、节点增删、条件布尔／整数 key、等待汇合、函数作用域、中文 UTF-8 字节列、UTF-8 BOM、GB18030、CRLF、注释和函数保留、原源码不变、用户模块不执行。
- 类型检查、生产构建通过。React Flow 原有 `use client` 警告仍在，不影响产物。
- 真实转换器的独立生产 UI：编辑和打开确认清单时源码生成 0 次，明确确认后 1 次，重载恢复草稿并再开清单仍 1 次，Harness 调用始终 0。见 [计数与源码摘要](P2-SOURCE-001-ui-test.json)、[实际页面可访问性记录](P2-SOURCE-001-preview.ax.txt)。
- 本轮浏览器截图 API 两次返回 Unable to capture screenshot，未取得截图；没有用模拟截图替代。页面可访问性记录确认了成功状态、state.py 两栏源码与新增字段。视觉、嵌入尺寸和桌面主题由乙方补验。

## 交付文件

主计划、README、开发交接、上述 API 文档及本批证据；contracts/source-preview.ts、api-client/index.ts、backend/application.ts 与 source-previews.ts / test、frontend/App.tsx / source-preview.tsx / styles.css、Python worker __main__.py / source_preview.py / test_source_preview.py、根 package.json 测试入口。前端 dist 由构建生成。

`plugins/harness/**`、桌面 profile、乙方验收记录、示例源码和锁文件本批未修改。现有静态同源挂载及 API 委托应能直接使用新路由，需乙方重载实际宿主。

## 乙方接入与验收

1. 在隔离 Harness 加载本批产物和宿主代码，记录版本与环境；不使用生产 profile 代替隔离验证。
2. 使用新复制的 research-team 工作区，编辑 State 并核对清单；预览按钮可用，未接 adapter 的 Harness 按钮保持禁用。
3. 点击“确认并生成源码预览”，检查 state.py 生成文本包含字段、原源码保持不变、工作区与主题跟随。
4. 检查新增节点＋普通边、条件分支／回路、整组汇合；新函数明确待实现，原函数不覆盖；复杂动态图给出可读拒绝原因。
5. 外部修改源码后旧草稿阻止生成；快速重复确认不重复生成任务；切换工作区／图后不显示上个预览；重载恢复草稿不自动生成。
6. 浅／深色、较窄嵌入尺寸、双栏代码滚动与焦点、宿主卸载关闭 worker 补验；新增 integration/P2-SOURCE-001.md，不能将本轮独立 UI 检查标为桌面通过。

## 下一步

第三步：持久差异审阅与确认应用、应用前版本冲突检查、原项目事务写入、失败恢复及撤销。第四步：Harness 在指定临时工作区实现节点行为并经统一事务应用。当前步骤不提前实现原项目写入，也不宣称全部功能完成。
