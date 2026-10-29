# dsh-langgraph-canvas GitHub 公开发布

项目仓库：https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas。发布账号：Cantarella-Fisalia。更新：2026-10-29。

DeepSeek Harness 官方 README 的 Community and support 要求插件仓库添加 `dsh-plugin` topic 以便发现：
https://github.com/deepseek-ai/deepseek-harness#community-and-support

仓库主题和根目录／插件子包的 keywords 使用：

```text
dsh-plugin, deepseek-harness, dsh, langgraph, ai-agents, multi-agent, visualization, developer-tools
```

GitHub topics 与 package.json keywords 是两处元数据；仅修改 keywords 不会自动设置 GitHub topic。公开仓库不等于发布到 npm，也不保证目录立即收录。

源码插件位于 plugins/harness，main 根目录是私有工作区，不可当成独立 bundle 直接安装。v0.9.0 新增完整发行包：生成内容单独保存到 codex/distribution-v0.9.0 分支和 v0.9.0 标签，包含前端 dist、预编译 JavaScript 后端、协议、Python worker 和许可；安装不需克隆或构建。官方格式索引在 main/market/index.json，固定指向发行提交；添加该索引后可在官方 Discover 搜索安装。GitHub Release 同时提供 tgz 和 SHA256SUMS，详见 [分发与安装](DISTRIBUTION.md)。不发布 npm 包，也不宣称进入官方默认目录。

现有插件已声明 MIT，本批补齐根 LICENSE 和仓库元数据，未更改模型通道、API、源码事务或桌面 profile。运行缓存、凭据、调试 overlay、原始截图／日志和验收附件保留本地；公开文档可能仍包含示例目录或历史交接的本地附件引用。

首次公开发布已完成，默认分支为 main；源代码和仓库 topics 已远程核对。类型检查、162 项回归、生产构建与 11 项插件预检通过。

BRAND-RENAME-001：仓库更名为 dsh-langgraph-canvas，保留仓库ID、提交历史和 dsh-plugin 等 topics；原仓库链接由 GitHub 重定向。新包 v0.7.0 的升级步骤见 README，项目本机目录与 .vislang 数据保留。

DISTRIBUTION-001：174 项回归通过；官方桌面 0.2.1-rc.3 市场服务读取线上索引并搜索成功，官方 CLI 的 tgz／Git 隔离安装通过，Git 安装后 12 项预检通过。真实 Electron GUI 交互待复测；生产 profile 保持不动。
