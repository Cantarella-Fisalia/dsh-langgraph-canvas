# dsh-langgraph-canvas 开发交接

更新：2026-10-29。需求依据：[PROJECT_PLAN.md](../PROJECT_PLAN.md)。职责以 [双方协作协议 v1.0](COOPERATION_AGREEMENT.md) 为准。

## 当前交付

DISTRIBUTION-001：宿主 v0.9.0、主计划 v0.35，制作独立发布包与官方 Discover 可读取的社区索引。174 项回归、构建与仓库外安装后 12 项预检通过；发布时将后端／协议编译为 JavaScript，安装无需克隆或构建。GitHub v0.9.0 与 HTTPS 索引已公开；官方 0.2.1-rc.3 市场服务线上搜索、CLI 分别安装 tgz／固定 Git 源及安装后 12 项预检均通过。Electron GUI 仍待乙方复测，生产 profile 未改，见 [分发记录](handoffs/main/DISTRIBUTION-001.md)。

以下为历史交付。

DSH-CANVAS-RENAME-001：按用户选定的 dsh-langgraph-canvas 统一命名，宿主 v0.8.0、主计划 v0.34；两代旧数据兼容，新增中英文非官方声明、官方许可／品牌核查及依赖许可材料。用户本机 profile 与乙方未提交接入记录保持不动。实际目录类型检查、174 项测试、构建和 12 项预检通过；26 份依赖许可随构建交付，版权／品牌核查不构成零风险保证。见 [本批交付](handoffs/main/DSH-CANVAS-RENAME-001.md)。

以下为历史交付。

BRAND-RENAME-001：品牌统一为 dsh-langgraph-canvas，宿主包 v0.7.0，主计划 v0.33。命名覆盖清单、前后端、桥接、路由、提示词、worker 模块、测试和中英文文档；保留旧偏好／草稿／回执／行为记录与解释器变量的兼容读取，.vislang 数据位置不变。实际项目类型检查、170 项回归、生产构建及 11 项插件预检通过，桌面需按升级步骤重新链接并复测。参见 [改名与升级](handoffs/main/BRAND-RENAME-001.md)。

以下为历史交付。

GITHUB-PUBLIC-001：已公开发布 https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas，默认 main；设置官方 dsh-plugin 等主题，补齐仓库元数据、MIT LICENSE、公开安装说明和隐私忽略规则。类型检查、162 项回归、生产构建与 11 项预检通过；本机缓存和原始运行附件未上传。无宿主代码、协议或 profile 变动。见 [发布记录](handoffs/main/GITHUB-PUBLIC-001.md)。

以下为历史交付。

AUTO-ANALYSIS-001：主计划 v0.31，宿主包沿用 v0.6.7。用户新授权取消只读解析必须点击的交互，嵌入架构页核对工作区及后台任务后，缺少当前版本 AI 结果则自动提交一次；复用缓存与任务，不因切图／轨迹返回重复排队。失败／取消后保留小 AI 按钮手动重试，源码修改确认不变，无协议／依赖／适配变更。实际 E 盘类型检查、162 项回归、生产构建及 11 项插件预检通过；自动触发与返回去重已在自有页面验证，真实账号与桌面复测待补。见 [交付与复测步骤](handoffs/main/AUTO-ANALYSIS-001.md)。

以下为历史交付。

SUBGRAPH-NAV-001：主计划 v0.30，宿主包仍 v0.6.7。调用节点本体只查看详情，明确点击“展开子图”才跳转；顶部返回沿实际进入路径逐级回到来源。当前页面内临时保留位置、未保存标记、视角与选中项，State／函数表始终对应当前图。移除前批同画布容器及其专用逻辑；无协议、依赖或 Harness 适配变更。实际 E 盘类型检查、154 项回归、生产构建及 11 项插件预检通过；本地页面返回恢复验证通过，桌面复测与截图视觉验收待补。见 [交付与复测步骤](handoffs/main/SUBGRAPH-NAV-001.md)。

以下为历史交付（内嵌方案已被本批取代）。

INLINE-SUBGRAPH-001：主计划 v0.29，宿主包仍 v0.6.7。点击双线图调用框就地展开大容器，内部横向展示目标图，外层 ID／边保持；同图多调用按实例隔离，框内详情绑定所属图，只读并保留单独打开编辑入口。逐层展开阻止祖先循环，有深度／节点预算；临时排布不覆盖保存位置，收起恢复位置和 dirty 标记。无协议、依赖或 Harness 适配变更。见 [交付](handoffs/main/INLINE-SUBGRAPH-001.md)。

以下为历史交付。

FLOWCHART-001：主计划 v0.28，沿用宿主包 v0.6.7 的前端更新。新增条件路由菱形、图调用双竖线框与目标导航、入口出口终止符、从上到下的分支排布；保留源图 ID、已保存布局和编辑确认。图调用仅用同版本已有关系，函数内部调用保持函数身份。修复选中／模式切换丢失节点尺寸而隐藏的问题。无新依赖／接口或 Harness 适配文件变更，乙方重载最新构建并补桌面验收，见 [记录](handoffs/main/FLOWCHART-001.md)。

以下为历史交付。

RAW-NAMES-001：v0.6.7，主计划 v0.27。按用户澄清把专业模式主标题从注册 ID 改为源码 functionRef，缺引用回退 ID、同函数复用附 ID；专业卡片／函数表去掉 AI 别名，标准模式仍通俗中文。边、State 关系及详情同步，无源码或模式偏好迁移。交付见 [记录](handoffs/main/RAW-NAMES-001.md)。

以下为历史交付。

VIEW-MODE-001：v0.6.6，主计划 v0.26。增加标准／专业显示模式，顶部选择并在本机保存。标准中文主显，专业注册 ID／函数／源码主显；边、State 和函数表统一切换。仅影响展示，保留选中节点与未保存布局，不重调模型、重扫源码或放宽编辑确认。交付见 [记录](handoffs/main/VIEW-MODE-001.md)。

以下为历史交付。

AI-NAMES-001：v0.6.5，主计划 v0.25。AI 解读增加带证据的中文功能名；画布主标题、边端点及 State 读写关系使用同一别名，原函数留在详情与左上角默认收起的函数模块表。旧缓存无名称时提示待命名，不增加看图自动调用或改源码标识符。135 项检查与本地页面交互验证通过，详见 [交付](handoffs/main/AI-NAMES-001.md)。

以下为历史交付。

AI-EVIDENCE-001：v0.6.4，主计划 v0.24。修复同会话再次解析时模型沿用旧任务读取区间、当前任务证据却只有初始三文件而直接失败的问题。每轮携带任务证据清单；缺口在原预算内补读，再要求同会话模型重新核对，之后完整校验。相邻同版本区间可联合覆盖，漏行与旧版本仍拒绝，错误显示具体区间。130 项检查与真实隔离 Harness 的同会话连续两次解析通过；详见 [交付](handoffs/main/AI-EVIDENCE-001.md)。

以下为历史交付。

AI-JSON-001：v0.6.3，主计划 v0.23。修复正常完成的长 JSON 回复缺括号而直接失败的问题：在原会话内至多一次格式纠正，占用总六轮／五分钟预算，沿用模型及历史、保持无工具；纠正后的结果继续经过源码证据校验。失败保留原图与缓存。119 项自动检查和真实隔离 Harness 验证通过。用户重启桌面后点击小 AI 按钮试用。详见 [交付](handoffs/main/AI-JSON-001.md)。

以下为历史交付。

VIEW-CACHE-001：v0.6.2，主计划 v0.22。修复切回架构时清空图并等待扫描：标签页会话快照先显示，后台校验；恢复当前图和已保存布局。短窗口只读重开复用后端已验证结果，文件变化／手动刷新／写入仍真实校验。内容哈希 JS/CSS 使用 immutable 缓存，HTML 仍检查更新。110 项自动检查与真实 Harness 切页缓存验证通过，模型调用数为 0。见 [交付](handoffs/main/VIEW-CACHE-001.md)。

以下为历史交付。

AI-RESTORE-001：v0.6.1，主计划 v0.21。修复切换轨迹再回架构后丢失 AI 进度：后台新增按项目／会话查询任务，前端先恢复原任务再开放按钮；恢复期间、其他会话占用或同步失败均不新建请求。回执不确定时保留原编号，重建页面不自动重发。107 项自动检查及实际隔离 Harness 切换恢复检查通过。详见 [交付](handoffs/main/AI-RESTORE-001.md)。

以下为历史交付。

CANVAS-SESSION-001：插件 v0.6.0，主计划 v0.20。State 改为图内左上角默认折叠浮层；删除“看懂这套流程”及大 AI 面板，业务入口出口附在 START／END。仅保留小 AI 按钮，点击即提交当前会话解读；普通查看不自动调用模型。

解读和行为生成都走真实当前 Harness 会话，沿用上下文与所选模型。Agent.followup 是 SessionController.prompt 内部同一公开提示入口，采用原生会话事件收取回复；插件不直接调用 llm.stream／全局默认模型。已验证会话级 tools=[] 与工具 guard、取消、普通工具恢复及副本生成。确认应用／撤销不变。详见 [本批交付](handoffs/main/CANVAS-SESSION-001.md)。历史默认模型和旧大面板描述由本批取代。

以下为历史交付。

AI-EXPLAIN-001：插件 v0.5.0，主计划 v0.19。按用户要求增加中文架构解读，沿用显式开始的只读默认模型通道；新增 architecture 证据协议、图关系／业务输入输出／字段用途与读写／节点注册类型及内部调用／实际条件的验证与展示。完整静态图不被解释覆盖；仅注释增强不扩大写回范围。17 个 IntentNavi 业务节点均直接注册函数，保留函数称呼。

93 项测试（42 Node＋51 Python）、构建、11 项插件预检通过。实际隔离 Harness 原生页面以源码副本和确定性提供方走通开始前 0 调用、3 轮读取后附加三图说明、函数内部调用关系、State 1/8 部分覆盖、4/4 条件、路由 61–64 行源码跳转、重开缓存不重调。保存截图和摘要，原项目／测试副本 10 文件字节未改；未用用户账号验证解释质量，未改生产 profile 或乙方记录。详见 [交付](handoffs/main/AI-EXPLAIN-001.md)、[协议](api/DEEP_ANALYSIS_API.md)、[使用指南](../USER_GUIDE.md)。旧缓存无架构解读时需明确重新分析。

以下为历史交付。

READ-DEEP-001：按用户本轮授权实现静态索引＋AI 按需读取＋证据校验，插件 v0.4.0。修复项目内多级导入／try 转发／常量／节点注册表与 State 继承；业务图默认展示，文档／示例需勾选，显示实际目录与来源。IntentNavi 原项目只读扫描从仅 9 张 docs 图恢复为 3 张业务图＋9 参考图，源码摘要未变，未执行项目。

AI 为独立只读任务：Harness 全局默认模型、无工具、明确点击开始后调用、有限跨文件读取、已读区间及版本检查、推断标记、版本缓存与取消。完整静态图优先，推断与注册表图当前只读；源码事务不采用 AI 缓存为事实，读取支持不等于源码编辑支持。84 项测试与构建、11 项插件预检通过；原生隔离 Harness 使用源码副本与测试提供方验证业务图及 AI 确认／完成／缓存，未使用用户账号或改生产 profile。详见 [READ-DEEP-001](handoffs/main/READ-DEEP-001.md)、[API](api/DEEP_ANALYSIS_API.md)、[用户指南](../USER_GUIDE.md)。

以下为历史交付。

PYTHON-RUNTIME-001：已修复乙方独立复测发现的解释器选择差异。统一模块 scripts/runtime/python.mjs 供宿主、PythonWorker 和 npm test 使用；顺序 pythonCommand → DSH_LANGGRAPH_CANVAS_PYTHON → 存在的 D:/Anaconda/python.exe → PATH python。Worker 启动前以 -I -S 探测版本，不加载项目；不足 3.11 返回 503 / PYTHON_VERSION_UNSUPPORTED，附路径、实际版本和修复指引。显式无效配置不静默回退。

新 test runner 同时给 Node 创建的 worker 和 Python unittest 传入已验证的同一可执行文件。adapter 与行为任务检查在读取 graphs 前验证 /projects HTTP 状态，避免根因被 TypeError 遮盖。67 项检查、类型与构建通过；PATH 强制为 3.7.9 时 npm test 与单独 adapter 检查仍通过，显式指定 3.7.9 时按预期快速失败；实际旧版本 API 检查返回明确 503。

乙方原始 [接入验收](handoffs/integration/HARNESS-COMPLETE-001.md) 已阅读并保持不变；用户仍可按原使用指南重启桌面试用。本批没有重启或改动任何 Harness profile。详情：[PYTHON-RUNTIME-001](handoffs/main/PYTHON-RUNTIME-001.md)。

以下为历史交付。

HARNESS-COMPLETE-001：用户明确要求补全后自行测试，甲方本批接手真实行为 adapter，完整闭环已交付试用。正式路径 plugins/harness/lib/behavior-adapter.js，由宿主 index.js 注入；读取真实 llm 服务和全局默认模型，模型只返回代码 JSON，不给终端／文件／执行工具。插件校验后只改自有临时副本，经 Python 静态验收、独立审阅确认再写原项目。

61 项自动检查（27 Node + 34 Python）、类型与生产构建通过；实际 Harness 0.2.1-rc.2 隔离网页运行时的原生架构页已完成职责编辑→确认生成→确认任务→结果审阅→确认应用→撤销，应用只改 nodes.py，撤销恢复全部源码摘要。使用测试提供方，不是用户模型账号或实际 Electron 桌面验收。带实际宿主就绪查询的 12 项预检通过。

用户下一步：完全退出并重新打开已链接的桌面 Harness，配置全局默认模型，按 [使用指南](../USER_GUIDE.md) 试用并反馈。交付、边界与证据：[HARNESS-COMPLETE-001](handoffs/main/HARNESS-COMPLETE-001.md)。未修改生产 profile 或乙方记录；既有 FINAL-ACCEPTANCE-001 和 P3-BEHAVIOR-001 的“adapter 未接入”为历史结论，由本批实现取代。

以下为历史交付。

FINAL-ACCEPTANCE-001：第五步的甲方预检、机器报告及[桌面验收清单](acceptance/DESKTOP_ACCEPTANCE.md)已交付，状态待接入，**第五步未验收通过**。当前实际 E 盘插件没有注入 behaviorTaskAdapter，integration 目录尚无 P2/P3 新验收记录。54 项核心检查、类型与生产构建通过；实际插件模块的 11 项预检通过，但这使用最小 webServer/effect 上下文，不是实际 Harness 或桌面测试。

复跑：`npm.cmd run build` → `npm.cmd run acceptance:preflight`；缺 adapter 时退出码 2，报告 `.tmp/acceptance/latest.json`。不会提交模型任务，不改变乙方 profile；三个示例均复制到自有临时目录后修改。乙方接入真实适配后请完成清单的 D01–D12，另建 integration/FINAL-ACCEPTANCE-001.md，记录实际版本、任务 ID、源码摘要及结果，不覆盖本轮甲方报告。[本轮交付与原始报告](handoffs/main/FINAL-ACCEPTANCE-001.md)。

以下为历史交付。

P3-BEHAVIOR-001：第四步甲方主功能完成，状态待接入，整体第四步尚未验收。正式 adapter 契约为 HarnessBehaviorAdapter，由 ApplicationOptions.behaviorTaskAdapter 注入；端口 submit／getStatus／cancel 接受指定临时 cwd，不允许写原项目，不执行项目。主功能持久任务、上下文、取消确认、回执未知恢复及静态结果验收已实现，结果仍进入第三步独立审阅应用事务。

乙方实现依据：[P3_BEHAVIOR_TASKS_API](api/P3_BEHAVIOR_TASKS_API.md)。本批交付：[P3-BEHAVIOR-001](handoffs/main/P3-BEHAVIOR-001.md)。当前插件未注入 adapter，真实 Harness 任务尚未接通；必须保持不可用提示，不用合成 adapter 或旧意图接收器冒充完成。正式路径需乙方在实现前记录；本批未修改 plugins/harness 或 profile。

54 项检查及生产构建通过。合成 adapter 的隔离 UI：确认前调用 0，明确确认后 submit 1；任务结果待审阅时原源码不变，再确认应用只改 nodes.py，确认撤销后三文件摘要恢复。截图接口失败，已保存 AX 与摘要证据；不代表真实桌面或模型业务逻辑通过。乙方请另记 integration/P3-BEHAVIOR-001.md。

以下为历史交付。

P2-TRANSACTION-001：第三步主功能完成，状态待接入。已支持统一差异／完整源码对照、持久审阅记录、独立确认应用与撤销、项目锁、完整版本及字节检查、失败回滚与中断恢复。原项目写入现仅由明确确认的事务触发；新函数仍是待实现占位，不调用 Harness adapter。

接口：[源码事务 API](api/P2_TRANSACTIONS_API.md)。交付：[P2-TRANSACTION-001](handoffs/main/P2-TRANSACTION-001.md)。新增 /transactions 路由由现有同源委托转发；预览现在返回 transaction 元数据并持久保存。health 变为 p2-transactions / readOnly:false，插件自己的旧只读说明需乙方核对。无新依赖、未修改插件文件／profile／乙方记录。

41 项自动检查、生产构建通过；独立生产 UI 实际确认应用只改 state.py、确认撤销恢复三文件摘要，Harness 调用 0。截图 API 无法抓取，留存 AX 与摘要证据；视觉与真实桌面验收仍待乙方。乙方另记 integration/P2-TRANSACTION-001.md，并重载宿主代码及产物，不把本轮主功能检查当作桌面通过。

以下为历史交付。

P2-SOURCE-001：第二步主功能完成，状态待接入。增加独立确认生成入口、临时 Python 副本转换、语法／结构重新核对及源码前后对照。原项目源码不写入；Harness 提交仍保留原确认门禁。

接口：[源码预览 API](api/P2_SOURCE_PREVIEW_API.md)。交付与支持范围：[P2-SOURCE-001](handoffs/main/P2-SOURCE-001.md)。无需新增宿主私有调用，现有同源 API 委托会转发新增 source-previews 路由。乙方需重载宿主及前端产物，补验真实桌面的确认门禁、双栏展示、工作区切换、浅／深色和异常提示，另记 integration/P2-SOURCE-001.md。当前 34 项自动检查及构建通过，独立生产 UI 检查了真实临时转换和源文件哈希；不代表桌面验收通过。

当前转换使用 AST 定位 + 精确片段替换，按支持范围保留既有源码与注释；与初稿 LibCST 方案的调整已同步到主计划 D016，不新增 Python 依赖。复杂写法保守拒绝。

以下为上批记录。

P2-DRAFT-001：五步路线中的第一步主功能已完成，状态待接入。新增节点／边／条件／整组汇合／State 字段草稿、本地恢复、修改清单和独立确认按钮；后端确认、版本及幂等检查已实现。默认无接收器，最终按钮明确显示待接入；本轮未打通真实 Harness 编码或源码写回。

乙方接入依据：[P2 草稿 API](api/P2_DRAFT_API.md)；交付与验证：[P2-DRAFT-001](handoffs/main/P2-DRAFT-001.md)。ApplicationOptions 可选注入 editRequestAdapter，但本阶段只接收结构意图，sourceWriteAllowed:false。不得绕过后续临时工作区与应用事务直接写原项目。宿主后端入口新增模块，加载新宿主代码需要重新加载／重启实例；插件源码与 profile 本轮未改。

以下为历史批次记录。

UI-LANGGRAPH-001：当前界面只展示 LangGraph 结构，图级共享 State 固定在画布上方，节点和边有明确标注及可点击详情。移除重复项目侧栏，隐藏未接入扩展入口；单图直接展示，多图才提供选择。业务 API、解析协议及 Harness 接入文件未变化。

本轮主功能预览验证已完成，详情与截图见 [UI-LANGGRAPH-001](handoffs/main/UI-LANGGRAPH-001.md)。乙方需在实际桌面嵌入尺寸下补验 State 常驻、节点与边点击、浅色／深色主题，以及多图切换。以下记录保留为历史批次。

UI-EMBED-001：按用户要求完成原生架构视图、工作区共用和主题对齐；隔离 Harness 验证通过，用户桌面补验待乙方。

详见 [本轮交付](handoffs/main/UI-EMBED-001.md) 与 [宿主桥接协议](api/HARNESS_VIEW_BRIDGE.md)。本轮得到用户明确授权后修改了 plugins/harness/client/client.js 和说明／清单；未修改宿主 lib/index.js、桌面 profile 或乙方验收记录。

P1-READ-001：此前甲方主功能已交付，乙方已完成同源挂载与隔离验收，桌面仍需重启确认。乙方原始记录见 [P1 集成验收](handoffs/integration/P1-READ-001.md)。

详见 [甲方交付清单](handoffs/main/P1-READ-001.md) 与 [P1 API](api/P1_READ_API.md)。

已实现独立前后端、Python 静态解析、跨文件源码定位、图与诊断、文件变更刷新、拖动布局保存。包含循环、并行汇合和路由三个示例。源码结构仍只读；MCP/RAG/Tools/Skills 仍为预留。

## 乙方下一步

1. 重新加载桌面客户端，确认“架构”页签和空白会话顶部“◇ 架构”入口。
2. 在两个工作区切换，核对目录、图和节点详情不串用；核对空目录提示。
3. 在浅色／深色主题中核对画布、节点、诊断及源码对比度。
4. 补验非空会话页签、桌面 dsh-app 来源、布局保存与 SSE 生命周期。
5. 新建 docs/handoffs/integration/UI-EMBED-001.md 记录实际桌面结果；保留旧批次证据。

本轮再核对 UI-LANGGRAPH-001：State 在不选节点时也可见；普通入边不能误显示为等待汇合；点击连线标签应对应正确来源；单图无多余图列表，多图切换后 State 和选择态同步更新。测试结果另记 integration/UI-LANGGRAPH-001.md。

P2-DRAFT-001 补验重点：未确认时接收器调用次数保持 0；确认后只接收一次；通道未接入、源码已变化、草稿无效或已接收时不能提交；恢复草稿不自动提交；工作区之间不串草稿。请新增 integration/P2-DRAFT-001.md 记录实际桌面结果，区分真实编码通道与测试接收器。

标准 Vite 产物仍由 apps/frontend/dist 同源挂载，不能直接覆盖到 client/client.js。

## 历史接入基线

P0 0.1.0 已有宿主路由 /dsh-langgraph-canvas/api/health 和内置示例 /graph，以及设置页面板。此前隔离 profile 有加载记录和截图；当前新工作台需另行接入，不能用 P0 示例作为 P1 验收证据。

桌面启动 BOM 故障已有限修复，记录见 [BUG-DESKTOP-JSON-BOM-001](handoffs/main/BUG-DESKTOP-JSON-BOM-001.md)。该修复不代替 P1 桌面集成验证。
