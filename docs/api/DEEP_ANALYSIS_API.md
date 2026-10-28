# 只读 AI 深度解析 v1

2026-10-28，插件 v0.6.7，前端自动触发策略 AUTO-ANALYSIS-001。任务协议位于 packages/contracts/src/analysis.ts，架构解读协议位于 packages/contracts/src/explanation.ts；宿主入口 plugins/harness/lib/analysis-adapter.js，经 ApplicationOptions.analysisAdapter 注入。沿用现有同源 API、项目注册和工作区路径约束；嵌入前缀 /vis4agent/api/v1。

| 路由 | 用途 |
| --- | --- |
| GET /analysis-support?sessionId=... | 检查当前会话、忙碌与接口状态，无模型 I/O |
| POST /projects/:id/analysis-tasks | 必须 schemaVersion:1、confirmed:true、baseRevision:64 位摘要、requestId:8–100 字符、生产会话 adapter 要求 sessionId；返回 202 任务 |
| GET /projects/:id/analysis-tasks?sessionId=...&requestId=... | 恢复当前会话的活动任务或最新终态；可选 requestId 定位不确定回执，无模型 I/O |
| GET /projects/:id/analysis-tasks/:uuid | 读取状态与 filesRead |
| POST /projects/:id/analysis-tasks/:uuid/cancel | confirmed:true；取消等待及后续处理 |

任务状态 queued／reading／analyzing／ready／failed／stale／cancelled。相同项目请求编号幂等；一项目同时至多一任务，全实例最多 100 条内存记录，终态可淘汰。宿主重启不重发任务，旧 ID 返回 404；已完成缓存可重用。用户已要求自动只读解析：嵌入页核对源码及后台状态后，缺少本版本有效缓存时自动提交一次，沿用 confirmed:true 的任务协议；小 AI 按钮保留明确重试，处理中再点可取消；切换视图不取消后端任务。取消会停止本地等待；提供方可能不响应 abort，其已计费用量不保证可退。已经开始的本地缓存原子写入可能在取消时完成；它只包含经过校验的派生图，不修改源码。

普通 analyze 仍由 Python AST 得出基础结构；deep-context 建立业务 Python 的导入／符号索引，deep-source 只代读索引范围的文件与指定行，模型没有工具、终端或文件写权限。通过 sessionController.inspect／resolveAgent 找到当前会话，由 Agent.followup（SessionController.prompt 内部同一公开入口）提交真实用户消息，使用原生会话上下文和模型路由。不创建独立会话或直接调用 llm.stream。客户端从受信任宿主上下文桥接 sessionId，后端核对项目与会话目录。注释视作数据，不作为操作指令。

预算：扫描最多 2000 个 Python 文件，单文件 2 MiB，优先业务源码；忽略隐藏、依赖、构建目录和链接目录。参考目录按 docs/doc/examples/example/test/tests/archive 分类，AI 排除这些相对目录；当前没有自定义分类覆盖。模型最多 6 轮、每轮最多 6 段读取；总计最多 40 段、768 KiB，单段 1–300 行且不超过 96 KiB，整体任务 5 分钟。索引过大／超预算会明确失败并保留静态结果，不宣称恢复任意动态 Python。

AI 输出 graphs，每图最多 500 节点／1500 边／300 State 字段，总共最多 40 图。file＋scope＋symbol 构成与静态相同的图 ID。图入口、State、字段、节点注册（边界除外）、可选实现与边证据都必须位于实际已读取且字节摘要一致的区间。校验路径、行号、格式、重复 ID、端点及等待汇合分组；不证明证据与语义的对应关系。返回 discovery.method=ai、completeness=inferred、readOnly=true，capabilities.structuralEdit=false；不接受模型自报写权限。

缓存由 worker 校验后保存 .vislang/analysis-cache/latest.json，最多 2 MiB、原子替换、数据摘要及源码版本绑定；损坏／过期回退到静态。同版本缓存有效时普通刷新不调用模型；无有效结果且满足自动触发条件时，嵌入页自动补充一次，失败或取消后不循环重试。完整静态同 ID 图优先，部分图可由 AI 补充，新推断图并入业务图；AI 返回空图时静态图仍保留。Analyzer.scan 与源码事务不载入 AI 缓存，AI 结果不能成为确定性源码转换的权威依据；前端与转换器均保留只读门禁。

GraphDocument 新增可选 discovery 来源／分类／完整性／只读原因；State 与字段支持可选源码位置。ProjectAnalysis 新增 scan 范围和 deepAnalysis 缓存元数据。参考过滤发生在前端，后台完整返回所有图与原源码版本，不因隐藏 docs 而缩小既有事务冲突检查范围。

## JSON 格式纠正（AI-JSON-001，v0.6.3）

只对正常完成且通过会话通道边界的文本执行严格 JSON.parse；允许整个回复包在完整 JSON 代码围栏内。格式错误时，在同一任务、同一会话历史和所选模型下至多一次格式纠正，计入总六轮与五分钟预算，不另外扩大上限。纠正消息只包含格式说明、回复字符数和剩余轮数，不复制原回复／提供方异常正文；原生会话历史已有上一条回复。

不截取看起来像 JSON 的片段、不自动追加括号、不执行 eval，也不读取无效回复内的 readFiles。纠正仍可返回合法读取请求或最终对象，按原流程继续核对读取范围、图 ID、源码证据与版本。再次无效或轮数用尽明确失败，静态结构和既有缓存保留。取消、提供方错误、工具调用、输出超限、中断或非正常结束继续立即拒绝，不触发格式重试。格式纠正不会单独因打开视图或恢复任务发生；当前版本首次缺少结果时，可由 AUTO-ANALYSIS-001 自动发起新的解析任务。

## 本次任务证据与补读（AI-EVIDENCE-001，v0.6.4）

宿主 adapter 为每次 analyze 分配唯一 analysisId，所有后续消息携带同一编号、revision、suppliedRanges 与当前轮剩余预算；它不替代后端 task.id／requestId，前端恢复协议不变。当前会话的旧任务、图索引、静态图位置和模型记忆不能当作本次已读证据。

最终 JSON 先检查已知协议中的源码引用。索引内有效但未覆盖的区间会去重、减去当前已读范围、按文件聚合附近缺口及其间上下文、按最多 300 行拆分；每批至多六段，使用原 readSource，因此仍受 40 段／768 KiB／版本／路径约束。补读后向当前会话发出 evidenceCorrection，要求依据新源码重新核对并返回完整 JSON；不在补读后直接采用旧回复。剩余缺口可在后续轮次继续处理，与格式纠正和显式 readFiles 共用六轮及五分钟预算。末轮仍有缺口时不再补读，失败说明具体 file:line–endLine。未知文件、参考目录及无效／越文件行号不自动读取，继续拒绝。

最终 Python 校验保持权威；同文件、同当前字节摘要的连续或重叠已读范围可以共同覆盖一条引用。缺一行、跨文件或旧版本不能桥接。证据缺口错误列出具体引用及本次对应已读范围，不笼统断言模型编造。取消、源码变化、无有效预算时停止；保留静态图及既有缓存，不增加自动应用权限。

## 架构解读（AI-EXPLAIN-001）

同一次模型最终输出可增加 architecture，graphs 可以为空数组。architecture.schemaVersion=1，overview 为带证据的总览，graphs 按 graphId 解释 purpose／entry／exit、stateFields、nodes 与 conditions，relationships 解释图间关系，unresolved 列出待确认内容。所有 ExplainedText 形式为 {text,evidence:[SourceLocation,...]}，每条文字 1–1800 字符、1–10 个证据，必须引用实际读取且版本一致的区间。

每图最多 300 字段／500 节点／1500 条条件说明，最多 40 图／100 关系／40 条待确认。字段名、读写节点 ID、节点读写字段名与条件 edgeId 必须出现在已知结构中，不允许解释附带结构修改。field.role=input/intermediate/output/mixed/unknown。条件说明只关联条件边，需解释实际判断与 else，不把返回标签当作判断条件；新增 GraphEdge.routerSource 可直接跳到静态路由定义。

nodes.execution=function/callable/subgraph/unknown。函数内部调用多个辅助函数不构成新的注册类型；已静态确认 function 的节点不能被 AI 改标为可调用链或直接子图。内部 calls 最多 16 个，逐项 name＋source，提供展开查看。GraphNode.execution 是独立元数据；不扩大现有 kind 与源码编辑支持范围。

关系 kind=registered_subgraph/indirect_call/shared_state/possible，端点均为已知业务图；调用关系必须给 viaNodeId；间接调用须至少两处 callPath 源码，每个跳转分别核对已读证据。静态函数节点不能被标为直接注册子图。校验引用与位置不证明调用链语义成立，所有解释均标 AI 解读；未知链路应保留 possible／unresolved，不编造联系。

解读附加到 ProjectAnalysis.architecture，完整静态图保持原样，AI 说明不进入结构草稿原始描述、行为需求或源码事务。后端重新读取缓存时再次检查解读引用、证据与版本。旧缓存可继续读图，但没有架构解读时需再次点击小 AI 按钮；不自动发起请求。前端按已覆盖字段／条件 ID 计算数量，缺项显示尚未解读；不把部分返回伪装成全覆盖。说明对应已保存源码，不含本地草稿。既有六轮／五分钟／读取大小预算与取消限制继续适用。

## 中文功能名（AI-NAMES-001，v0.6.5）

NodeExplanation 新增可选 displayName:ExplainedText；text 必须含汉字、非空且最长 24 字符，提示模型以 4–12 字动作＋业务对象命名。evidence 与其余解读相同，必须是本次已读且版本一致的源码；adapter 缺口补读也覆盖名称证据。schemaVersion 保持 1，旧缓存未带名称仍可读取，不由后端凭英文标识符猜译。

名称是按 graphId＋nodeId 绑定的显示别名，不写入 GraphDocument.title、functionRef 或任何源码事务。前端画布、边端点、Inspector 和 State 读写关系统一使用中文名；同图重名附序号。函数模块表默认收起，包含中文名、真实函数／注册 ID、职责与源码位置。缺名称时显示序号占位及待命名提示；自动补充或手动重试解析时随解读一起生成，不新增独立命名请求。名称缓存和失效沿用 architecture.revision。

## 显示模式中的命名（RAW-NAMES-001，v0.6.7）

标准模式主显带证据的中文 displayName；专业模式主显 GraphNode.functionRef 原始引用，不采用 AI 命名。引用缺失时回退 node.id；同图多个节点复用相同引用时附 [node.id] 区分。START／END 保留虚拟边界名称。专业卡片和函数表不再显示 AI 中文别名作为节点名，AI 职责说明仍可查看。名称选择是纯展示逻辑，原图 ID／functionRef、读写权限与 current-session 模型协议不变，模式切换不调用模型。

## 当前会话约束（CANVAS-SESSION-001）

解读消息和 JSON 回复进入原生对话历史。sessionId 仅接受 1–128 位字母、数字、下划线与连字符；没有会话、工作区目录不符、缺少宿主工具隔离接口或会话忙碌时不提交。同项目另一会话正在解读时返回冲突，不挪用那一会话的结果。请求编号同时绑定源码版本与会话；回执丢失可用同编号查询，禁止换编号自动重发。

仅在已认领的插件回合生效：system-prompt/assemble 令 tools=[]；agent 作用域 tools.guard 单调拒绝工具执行。监听本会话 assistant/message 与 turn/end 获取原生文本和模型信息，不拼接跨会话事件。工具回复、中断、超长或非正常结束均不采用；安全错误不展示提供方任意正文。其他 steer 输入回排其普通下一轮，不混进解读任务。取消仅移除本任务待处理消息／中断本任务已认领回合，保留其他队列；任务结束释放钩子与 guard，普通对话恢复工具。分析与行为通道共用会话租约。

前端不再展示大 AI 面板／架构概览；State 为图内左上角默认收起浮层，入口出口在边界节点，节点／条件边仍提供完整详情与证据。AI 缓存中的 overview／relationships 保留协议支持，本版没有独立的大关系面板。

## 视图切换恢复（AI-RESTORE-001，v0.6.1）

GET 集合路由返回 AnalysisTaskSnapshot={runtimeId,task,blockedByOtherSession}。必须提供合法 sessionId；优先当前项目当前会话的活动任务，其次 requestId 对应的本会话任务，再次最新终态。另一会话有活动任务时只返回 blockedByOtherSession:true，不泄露该任务信息，不允许当前会话按钮误取消它。task 新增 requestId，便于同一请求回执核对。runtimeId 标识本次后端实例，仅用于恢复判断，不是鉴权凭据。

页面重建先查询；已有任务或未核对票据时只恢复，不自动 POST。无当前版本有效结果、无任务／票据／错误，且该项目／会话／版本未自动尝试时，按 AUTO-ANALYSIS-001 自动提交一次；每 1.6 秒更新后台任务状态，离开只停止观察，不取消后台任务。查询失败时只允许再次 GET 同步，不以“未知”等同“无活动任务”。提交前保存本标签页 sessionStorage 票据（API 基址＋项目＋会话隔离），只含请求号、源码版本、runtimeId；另存最多 16 个版本的自动尝试标记，页面内兜底最多 128 个作用域。回执不确定时，明确再点击复用原请求号和版本；后台仍执行时按原编号幂等返回，不生成另一份排队任务。存储不可用仍可通过后台发现已登记任务。旧查询／旧组件的迟到响应不能覆盖新状态或触发新的提交。

runtimeId 变化时丢弃旧本地未确认票据并提示核对，不自动恢复或重发模型任务。后端任务仍为内存记录（上限 100，终态可淘汰），未增加跨宿主重启自动续跑。派生结果缓存与独立源码应用边界不变。
