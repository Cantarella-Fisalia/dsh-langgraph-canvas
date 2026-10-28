# UI-LANGGRAPH-001：LangGraph 结构视图

日期：2026-10-23。负责人：甲方。依据：用户确认先只看 LangGraph 结构，State 需突出，节点和边需标清；PROJECT_PLAN v0.10 / D014。

## 本轮实现

- 只保留 LangGraph 相关展示，不做项目完整目录树、模块依赖或全结构图。前端移除重复项目侧栏，MCP/RAG/Tools/Skills 未接入按钮隐藏；原扩展目录与接口保留。
- 图级 State 在画布上方常驻，展示状态引用、字段及原始类型注解（含已解析的 Annotated 内容）；标明静态定义，未展开字段不等于空 State。未解析 reducer 的语义，不展示运行时值。
- 节点卡片展示注册名称、实现函数和职责；START/END 单独标为流程边界。去掉可能暗示执行顺序的节点序号，不推断每个节点都是智能体。
- 连线均有文字与箭头：直接流转、同来源多条普通边的并行分发、条件分支值、等待汇合。条件边用虚线，汇合边用较粗线。连线标签放在独立可点击层，避免线条遮挡点击目标。
- 节点详情显示进入／离开连线和源码；边详情显示来源／目标、路由函数／分支值或全部汇合前置节点，以及连线注册源码。普通多入边不冒充等待全部完成。
- 默认给画布留出完整宽度；选择节点、边或诊断后展开详情，支持收起。解析诊断折叠在底部。
- 单图直接展示，仅多图时显示图选择；切换同步更新 State、图和详情选择。当前不推断主图及父子图嵌套关系。

官方概念依据：[Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)、[Subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs)。一个项目可以定义多个图；子图是被用作另一个图节点的图，不能把“默认看一个图”当成项目只能有一个图。

## 范围与验证

仅修改前端 App、样式及主功能文档。后端 API、Python 解析、数据协议、布局文件格式、Harness 接入层和桌面 profile 未改；沿用原生视图入口、工作区桥接和主题 token。

主功能侧验证：

- 15 项既有自动检查通过；TypeScript 检查及 Vite 生产构建通过。React Flow 的 use client 打包提示仍为非阻断提示。
- 浏览器真实读取 research-team：State 的五个字段、START/END、三个业务节点及五条连线显示；点击 writer 查看职责、函数和 nodes.py。
- 点击 reviewer → writer 的条件边，详情为 revise / route_review / graph.py 第 12 行。
- 真实读取 parallel-team：State 的 Annotated 类型原样显示；两条 START 出边标为并行分发；汇合边正确显示 researcher、analyst 两个前置节点及第 31 行注册源码。
- 临时的两图源码夹具（不作为产品示例交付）验证单图／多图选择显示、切换到 ReportState 后节点和字段同步更新；无图目录不残留旧 State 或详情。
- 浏览器控制台未见错误。截图为独立开发预览，不是本轮桌面验收证据。

![State 与 LangGraph 结构](UI-LANGGRAPH-001-state.png)

![条件边与注册源码](UI-LANGGRAPH-001-conditional.png)

![汇合边的全部前置节点](UI-LANGGRAPH-001-join.png)

## 接入方补验

构建产物仍在 apps/frontend/dist，API 和嵌入协议不变。请重新加载已链接插件，在 Harness 中检查实际尺寸下 State 与画布的可读性、节点及连线标签点击、主题、单图／多图切换、布局保存和工作区切换；新增 integration/UI-LANGGRAPH-001.md 记录实际结果。

本轮完成的是结构查看方式调整；增删节点／边写回 Python、Harness 行为生成和运行时追踪仍未实现。
