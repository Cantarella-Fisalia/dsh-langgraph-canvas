# 分发、索引与安装

版本：0.9.0（开发预览）。本项目独立维护，与 DeepSeek、LangChain 官方无关。

## 在官方桌面中搜索安装

按官方 [插件市场指南](https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market)，启用“自定义插件市场”，在 Discover 添加下面的索引，然后搜索 dsh-langgraph-canvas：

`https://raw.githubusercontent.com/Cantarella-Fisalia/dsh-langgraph-canvas/main/market/index.json`

索引属于当前 profile；官方文档说明宿主默认不携带索引源。配置本索引后可以在官方界面搜索、下载和安装，不代表所有未配置的用户都能搜索到，也不代表官方默认收录。本项目不能单方面写入官方随软件分发的插件名单。

## 运行要求与升级

Node.js 24+（可用桌面随附运行时）、Python 3.11+；Git 源安装还需要 Git。解析不需要安装 LangGraph 或 Python 第三方依赖。解释器可由 DSH_LANGGRAPH_CANVAS_PYTHON 指定；无显式设置时保留现有兜底。

旧 vis4agent／langcontour 安装先卸载旧条目，再安装当前包，避免重复注册。同名源码 link 安装切换到发行版前也先移除原 link。项目 .vislang 数据可保留；安装和升级不自动应用源码修改。若宿主要求重启，完全退出桌面后重开。

## 可复核的发布内容

- 主分支：源码、发布脚本与 market/index.json。源码根是私有工作区，不应直接当 bundle 安装。
- 分发分支 codex/distribution-v0.9.0、标签 v0.9.0：生成的独立运行包，根 package.json 声明 dsh.bundle 与客户端入口。
- GitHub Releases：dsh-langgraph-canvas-0.9.0.tgz、SHA256SUMS。可在插件页“添加插件”输入下载文件的本地绝对路径，不需要构建。
- 索引使用固定 Git 提交；不指向移动分支，也不依赖 npm 账号或发布后构建。首次安装 Git 源需下载仓库版本，速度取决于访问 GitHub 的网络。
- RELEASE_MANIFEST.json 保存来源源码提交与文件 SHA-256；许可原文随包保留。无 prepare／postinstall 构建钩子。

## 维护者发布

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd run release:package
npm.cmd run release:verify
```

输出位于 .tmp/releases/版本/。verify 将 tarball 安装到仓库外的隔离目录，校验入口、客户端导出、清单和资源完整性，执行真实 Python 与事务预检；不调用用户模型。发布时将 latest.json 指定的 staging 目录提交到新的分发分支并打版本标签，上传 tgz 与校验文件，再用该分发提交更新索引。不可把源码子目录直接 npm pack 当成完整发行版。

验证范围和实际发布证据见 [DISTRIBUTION-001](handoffs/main/DISTRIBUTION-001.md)。隔离宿主／打包测试不替代乙方的真实 Electron 桌面交互验收。
