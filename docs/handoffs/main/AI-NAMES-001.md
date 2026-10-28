# AI-NAMES-001：中文功能名与函数模块表

2026-10-27，插件 v0.6.5，主计划 v0.25。甲方主功能交付，待用户加载桌面及账号模型试用。

用户面向小白，希望流程主要显示易懂的中文功能词，并保留函数对照表。本批在现有 AI 架构解读中加入节点 displayName（带源码证据），要求按实际实现以动作＋对象命名，建议 4–12 字、上限 24 字；无法确认时标职责待确认。不是对英文函数名逐词硬译。

画布主标题、边端点详情、相邻节点导航与 State 读写关系优先显示中文名。同图重名附序号，不改变注册 ID。原函数和 ID 保留在节点详情；图左上角 State 旁增加默认收起的“函数模块表”，列出中文名、原函数／注册 ID、职责及源码位置，点击名称或源码位置打开节点。保持原有画布优先布局和宿主主题。

名称只是按 graphId＋nodeId 对齐的显示别名，不修改 Python 标识符或 GraphDocument 的原始 title／functionRef，不进入结构写回事务。随 architecture 缓存和源码版本失效。旧缓存未带名称保持可读，显示“功能步骤 N／待 AI 命名”；需用户明确点一次现有 AI 按钮，名称随解读自动生成，无单独命名请求或打开页面自动模型调用。

涉及前端 App、function-table、explanation-view、canvas-state、样式及测试；contracts/explanation 可选字段；Python explanations 校验；宿主 analysis-adapter 提示与 analysis-evidence 缺口检查；后端集成测试、版本与项目文档。按用户现有真实会话通道开发授权临时代修相关 adapter，宿主默认维护仍属乙方。未改生产 profile、模型选择、依赖或乙方验收记录。同步前以摘要检查并发修改。

135 项自动检查（80 Node＋55 Python）及类型检查通过。验证中文名与证据缓存、无效／过长／未读名称拒绝、旧数据兼容、同图重名、版本失效、原图保持、命名证据参与补读和后端到缓存读回。源码审阅、应用和撤销等既有回归继续通过。

本地真实前后端页面使用两节点合成示例，经实际 Python worker 校验并缓存带证据的合成名称，不冒充真实模型生成：画布显示“检索资料”“生成回答”，函数表对应 retrieve_context／create_answer；点击表中“检索资料”打开该节点、真实函数和 graph.py:5–6，边端点同样中文。State question 的读写关系显示“检索资料”“生成回答”。截图接口返回 Unable to capture screenshot，保留结构化观察，不宣称像素验收或完整 Electron 桌面验收；未调用用户账号模型。临时页面与开发服务已关闭。

同步后在实际 E:/Heng/vis4agent 再次通过类型检查、135 项测试、生产构建和 11 项插件预检，实际加载 v0.6.5。构建、预检摘要及修复源码摘要纳入证据；预检 desktopAcceptance=not_performed，不能代替用户 Electron 桌面和账号模型试用。脱敏证据见 [AI-NAMES-001-evidence.json](AI-NAMES-001-evidence.json)。完全退出重开 Harness 加载新版，再点一次现有 AI 生成本项目真实中文名；旧解读缓存不会自行补调用模型。
