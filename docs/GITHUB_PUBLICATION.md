# GitHub 公开发布

项目仓库：https://github.com/Cantarella-Fisalia/vis4agent。发布账号：Cantarella-Fisalia。日期：2026-10-28。

DeepSeek Harness 官方 README 的 Community and support 要求插件仓库添加 `dsh-plugin` topic 以便发现：
https://github.com/deepseek-ai/deepseek-harness#community-and-support

仓库主题和根目录／插件子包的 keywords 使用：

```text
dsh-plugin, deepseek-harness, dsh, langgraph, ai-agents, multi-agent, visualization, developer-tools
```

GitHub topics 与 package.json keywords 是两处元数据；仅修改 keywords 不会自动设置 GitHub topic。公开仓库不等于发布到 npm，也不保证目录立即收录。

插件仍位于 plugins/harness，沿用既有 dsh.bundle／dsh.client 清单和 cordis.patch.yml。根目录是工作区，当前不提供直接把 GitHub 根作为独立 bundle 的安装方式；必须克隆完整仓库、安装根依赖、构建前端，再 link 插件子目录。前端 dist 由构建生成，不提交生成物。宿主代码通过完整仓库定位后端和 Python worker，不可只复制 plugins/harness。

现有插件已声明 MIT，本批补齐根 LICENSE 和仓库元数据，未更改模型通道、API、源码事务或桌面 profile。运行缓存、凭据、调试 overlay、原始截图／日志和验收附件保留本地；公开文档可能仍包含示例目录或历史交接的本地附件引用。
