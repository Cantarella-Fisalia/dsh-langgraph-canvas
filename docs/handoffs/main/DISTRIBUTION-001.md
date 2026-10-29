# DISTRIBUTION-001：自包含发布包与 Discover 索引

日期：2026-10-29。负责方：甲方。状态：开发中。

用户授权制作、公开分发插件，让官方桌面端可以搜索并安装。本批临时接手分发所需的插件清单和版本调整；涉及 scripts/release、根 package.json、plugins/harness/package.json 与 lib/index.js、market/index.json、README 中英文、使用指南、主计划和交接文档。保留宿主接口与现有业务功能。

交付目标：构建包含前端、后端、协议、Python worker、适配器与许可的独立安装包；发布固定提交的 Git 分发版本及 GitHub Release；提供官方 format 1 索引。索引添加后在官方 Discover 搜索安装；不把自建索引冒充官方默认收录。

测试使用自有隔离目录和 profile，不自动修改生产桌面 profile，不调用用户模型账号。乙方未提交的 integration/BRAND-RENAME-001.md 保持原文与未提交状态。

依赖：Node.js 24+、Python 3.11+；分发的 Git 源需 Git。安装不执行自定义构建脚本，不要求使用者克隆源码构建。完成后补充实际安装证据与公开 URL。

## 本地验证（公开发布前）

类型检查与前端生产构建通过；174 项回归（118 Node＋56 Python）通过。生成包 108 文件，约 275 KB；已用 npm 安装到仓库外 node_modules，去掉全部三代 REPO_ROOT 覆盖后正常加载插件、客户端导出、前端与健康 API。包内 107 项文件 SHA-256 校验及 12 项真实 Python／确认应用／字节级撤销预检通过。

修复已定位的安装问题：Node 24 不允许 node_modules 内直接剥离 TypeScript，故发布脚本使用 TypeScript 编译器在维护者侧输出 ESM JavaScript，并重写相对 .ts 导入；运行包无 TypeScript 编译器依赖、无构建钩子。宿主入口优先发布 .js，源码开发保留 .ts 后备。预检兼容两种入口。

公开发布与官方市场搜索／安装验证进行中。未进行真实模型与 Electron GUI 交互验收；测试不改用户项目或生产 profile。
