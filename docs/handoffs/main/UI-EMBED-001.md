# UI-EMBED-001：原生视图、工作区与主题

日期：2026-10-23。负责人：甲方主功能开发。依据：用户本轮明确要求以及 PROJECT_PLAN v0.9 / D013。

## 交付

- 移除设置页启动的全屏浮层，注册官方 conversation.view“架构”页签。
- Harness 空白会话会隐藏视图页签，增加会话顶部“◇ 架构”按钮，切换现有 main 内容区。
- 通过宿主提供的会话和工作区状态自动读取当前目录；嵌入模式隐藏独立目录输入并清除旧项目结果。
- 跟随 Harness 当前主题的颜色、字体和明暗模式，画布与详情面板使用宿主语义 token。
- 保留独立开发预览、既有读取／布局能力与 MCP、RAG、Tools、Skills 预留。

用户明确授权本次原生入口改造，因此本批修改 plugins/harness/client/client.js、package.json 说明和 README。宿主 lib/index.js、安装配置、桌面 profile 以及乙方测试记录未改动；后续接入维护与桌面验收仍归乙方。

## 验证与证据

- npm test：6 项 Node（含工作区优先级、目录切换、主题消息、来源限制、原生入口注册与主区域切换）及 9 项 Python 检查通过。
- npm run build：TypeScript 检查和 Vite 生产构建通过。React Flow 的 use client 打包提示不影响产物生成。
- 本机安装的 Harness 客户端运行时 0.2.1-rc.2：核对官方插槽、layout、theme 和标准状态 hook 接口。
- 使用独立 DSH_HOME / vis4agent-ui profile、端口 62001；未复制账号／模型配置，未重启用户桌面实例。
- 实际点击空白会话顶部入口后，架构显示在 Harness 主区域；自动读取默认工作区目录（0 Python 文件），未要求输入目录；浅色和深色切换均同步。

![原生浅色视图](UI-EMBED-001-light.png)

![原生深色视图](UI-EMBED-001-dark.png)

自动检查中的状态模拟不能代替桌面实测。本轮未直接点击有消息会话的“架构”页签，未在桌面 dsh-app 来源下验证，多工作区切换仍需乙方补验。当前默认工作区为空，截图不作为真实 LangGraph 解析的新证据；源码读取的既有证据见 P1-READ-001。

## 乙方补验

重新加载客户端或重启桌面 Harness 后，核对页签和空白入口、两个实际项目的目录切换、浅色／深色下节点和源码可读性、布局保存及 SSE 清理。请新增 integration/UI-EMBED-001.md，不覆盖旧批次记录。

桥接细节见 [HARNESS_VIEW_BRIDGE](../../api/HARNESS_VIEW_BRIDGE.md)。
