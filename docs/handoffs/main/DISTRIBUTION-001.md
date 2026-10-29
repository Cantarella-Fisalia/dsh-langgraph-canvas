# DISTRIBUTION-001：自包含发布包与 Discover 索引

日期：2026-10-29。负责方：甲方。状态：分发链路测试通过；真实 Electron 桌面交互待乙方复测。

用户授权制作、公开分发插件，让官方桌面端可以搜索并安装。本批临时接手分发所需的插件清单和版本调整；涉及 scripts/release、根 package.json、plugins/harness/package.json 与 lib/index.js、market/index.json、README 中英文、使用指南、主计划和交接文档。保留宿主接口与现有业务功能。

交付目标：构建包含前端、后端、协议、Python worker、适配器与许可的独立安装包；发布固定提交的 Git 分发版本及 GitHub Release；提供官方 format 1 索引。索引添加后在官方 Discover 搜索安装；不把自建索引冒充官方默认收录。

测试使用自有隔离目录和 profile，不自动修改生产桌面 profile，不调用用户模型账号。乙方未提交的 integration/BRAND-RENAME-001.md 保持原文与未提交状态。

依赖：Node.js 24+、Python 3.11+；分发的 Git 源需 Git。安装不执行自定义构建脚本，不要求使用者克隆源码构建。完成后补充实际安装证据与公开 URL。

## 本地验证（公开发布前）

类型检查与前端生产构建通过；174 项回归（118 Node＋56 Python）通过。生成包 108 文件，约 275 KB；已用 npm 安装到仓库外 node_modules，去掉全部三代 REPO_ROOT 覆盖后正常加载插件、客户端导出、前端与健康 API。包内 107 项文件 SHA-256 校验及 12 项真实 Python／确认应用／字节级撤销预检通过。

修复已定位的安装问题：Node 24 不允许 node_modules 内直接剥离 TypeScript，故发布脚本使用 TypeScript 编译器在维护者侧输出 ESM JavaScript，并重写相对 .ts 导入；运行包无 TypeScript 编译器依赖、无构建钩子。宿主入口优先发布 .js，源码开发保留 .ts 后备。预检兼容两种入口。

公开发布、官方市场服务搜索与官方 CLI 安装均已验证。未进行真实模型与 Electron GUI 交互验收；测试不改用户项目或生产 profile。

## 公开交付与证据

- 发行版：[v0.9.0](https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas/releases/tag/v0.9.0)，公开、非 draft，提供 tgz 与 SHA256SUMS。
- 索引：[market/index.json](https://raw.githubusercontent.com/Cantarella-Fisalia/dsh-langgraph-canvas/main/market/index.json)，HTTPS 200、无重定向，官方 format 1 验证通过。
- 来源源码提交：`00074b29d7df8aa99f8f0b16860198c059a1b4ef`。固定发行提交：`4b10bde325490e64151b390112235c7b19143e64`。生成包在 `codex/distribution-v0.9.0` 分支及 `v0.9.0` 标签。
- tgz：274887 字节；SHA-256：`84027665b259bba4618327b16934989c5468e4b7f007c5d2f5c52a4220e97c20`。从公开下载地址重新下载比对成功，GitHub asset digest 一致。
- 官方桌面随附运行时实际版本：0.2.1-rc.3；pnpm 11.28.5。官方 parseMarketIndex 与 pluginMarket.search 读取线上索引，搜索 dsh-langgraph-canvas、LangGraph、画布均返回唯一插件，默认版本 0.9.0，生成固定 Git 安装参数。安装状态依赖隔离 fixture，不读生产 profile。
- 官方 DSH CLI 分别在两个全新隔离 profile 安装 tgz 与上述线上 Git 源，均退出 0；清单选择 dsh-langgraph-canvas bundle，dump-config 含实际插件行。未执行安装构建脚本。
- 在线 Git 安装后的实际包再次执行 12 项预检，全通过，覆盖前端资源、26 份许可、跨文件解析、SSE、草稿确认、审阅后应用、字节级撤销和卸载关闭；不是只读 manifest 就判成功。
- 完整测试报告在本次工作区 .tmp/distribution 与项目 .tmp/releases/0.9.0 本地保留，不上传账号、生产配置或原始会话。

## 用户与乙方下一步

在官方桌面“插件 → 实验性插件 → 更多”启用 Custom plugin markets，然后在 Discover 添加上面的索引，搜索 dsh-langgraph-canvas 安装。若原来使用 link，同名源码链接或旧别名请先移除，避免双重加载；项目 .vislang 保留。GUI 提示重启时完全退出重开。

本批未自动配置用户生产 profile；未做真实 Electron GUI 点击／视觉验收或真实账号模型调用。乙方复测原生“架构”入口、工作区／主题、当前会话 AI 与确认应用。自建索引添加后可搜索，不代表无需添加索引的官方默认收录。无 npm 发布；Git 分发与 tgz 均已可用。
