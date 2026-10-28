# Harness 原生架构视图桥接 v1

入口：conversation.view 的“架构”页签。空白会话由 conversation.header.leading 按钮调用 layout.selectPanel，显示同一个 main 架构组件。前端仍独立构建，经 /langcontour/app/ 同源 iframe 嵌入；不注册全屏浮层。

iframe URL 使用 embedded=1 和 apiBase=/langcontour/api/v1。嵌入模式隐藏独立品牌、顶栏和目录输入，不读取独立预览页的 lastRoot。

子页就绪后向父窗口发送：

```json
{ "type": "langcontour:ready", "schemaVersion": 1 }
```

宿主在加载、当前会话／工作区或主题变化时发送：

```json
{
  "type": "langcontour:host-context",
  "schemaVersion": 1,
  "workspaceRoot": "E:/my-project",
  "theme": {
    "colorScheme": "light",
    "tokens": { "--dsw-alias-bg-base": "#ffffff" },
    "fontFamily": "system-ui"
  }
}
```

目录来自 Harness 提供的 useSessions/useWorkspaces，优先使用包含当前会话的 workspace.path，未找到时回退到 session.cwd；无目录时传 null，前端清空旧数据。目录不放在 URL，不持久化另一套项目选择。布局继续保存在该项目的 .vislang/layout.json。

themeSource 订阅 theme/change；样式提交后再次读取 body 的计算样式，复制 --dsw-*、--dsh-font-*、--ds-font-* 变量和字体。业务样式通过 --vf-* 语义变量映射到宿主 token，独立开发预览提供中性浅色／深色回退。

消息双方校验 event.source 为对应父／子窗口及同源。桌面仅对 dsh-app: 处理自定义来源序列化为 null 的情况；HTTP 下不接受 null 来源。子页检查消息版本、字段类型与 token 名称白名单。消息不携带 token 或其他凭据，后端鉴权、文件范围与接口保持原约束。
