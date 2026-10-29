# dsh-langgraph-canvas

<p align="center">
  <strong>简体中文</strong> | <a href="README.en.md">English</a>
</p>

> **非官方声明：本项目是独立维护的社区插件，与 DeepSeek／DeepSeek Harness 官方及 LangChain／LangGraph 官方无隶属、合作、赞助或背书关系。相关名称仅用于说明兼容对象；相关商标与版权归各自权利人所有。**


**看清架构，从容改图。**

面向 **DeepSeek Harness 桌面端**的 LangGraph 可视化开发插件。直接读取工作区里的 Python 源码，在会话的“架构”视图中查看 State、节点、条件分支与图间调用，并通过草稿、差异审阅和确认应用来修改项目。

当前为开发预览版，Harness 插件版本 **0.9.0**。本项目是社区插件。

## 可以做什么

- 识别跨文件 LangGraph 定义，默认展示业务图，文档／示例图按需显示。
- 将 State 放在画布左上角；条件路由显示为菱形，图调用显示为双竖线框。
- 点击“展开子图”进入目标图，再沿实际进入路径返回，恢复原图视角与临时布局。
- 标准模式用 AI 生成的中文功能名和通俗说明；专业模式保留源码原函数名。
- 使用当前 Harness 会话及所选模型自动补充缺失版本的只读 AI 解析，复用缓存和后台任务；失败／取消后可手动重试。
- 编辑节点、连线、State 和节点职责，先保留草稿，再审阅差异、确认应用或撤销。

普通静态解析不执行用户 Python 模块。AI 解析会消耗当前会话的模型额度，需在当前会话选择可用模型；自动解析不会自动应用源码修改。证据校验能核对已读文件和行号，不能保证模型解释的语义完全正确。

## 安装到 DeepSeek Harness

需要 **Node.js 24+、Python 3.11+** 和 DeepSeek Harness 桌面端。通过 Git 源安装还需 Git。发布包已包含构建好的前端、后端、worker 与许可，不需自行克隆或构建；源码解析无需安装 LangGraph。

1. 打开 **插件 → 实验性插件 → 更多**，启用 **自定义插件市场（Custom plugin markets）**，进入 **发现（Discover）**。
2. 点击 **添加索引源（Add index source）**，粘贴：

   `https://raw.githubusercontent.com/Cantarella-Fisalia/dsh-langgraph-canvas/main/market/index.json`

3. 搜索 **dsh-langgraph-canvas** 或 **LangGraph**，核对版本与来源，点击 **安装**。
4. 进入项目工作区，在“对话／轨迹”旁打开“架构”；若宿主提示重启，请完全退出并重开。

这是由本项目独立维护、官方桌面支持读取的社区索引，每个 profile 只需添加一次；不代表进入官方默认目录或获得认证。详见 [分发与安装](docs/DISTRIBUTION.md)。

也可从 [Releases](https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas/releases/latest) 下载预构建 `.tgz`，在 **插件 → 添加插件** 中输入其本地绝对路径安装。多 Python 环境可在启动 Harness 前设置 `DSH_LANGGRAPH_CANVAS_PYTHON` 指向 Python 3.11+。

### 从源码开发安装

源码仓库根目录仍是私有工作区；生成的发布包根目录才是可安装 bundle。本地开发时使用：

```powershell
git clone https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas.git
cd dsh-langgraph-canvas
npm.cmd ci
npm.cmd run build
$pluginPath = (Resolve-Path ./plugins/harness).Path.Replace('\', '/')
dsh plugin --profile desktop add "link:$pluginPath"
```

## 从旧版升级

dsh-langgraph-canvas是原 vis4agent 的新名称。已安装旧包时，请先在 Harness 插件管理中卸载旧条目，再按上面的方式链接新版 plugins/harness 并完全重启桌面；不要同时加载新旧两份插件。

现有项目的 .vislang 目录继续保存布局、AI 缓存、行为记录和源码事务，不需删除或重新建项目。旧浏览器偏好、结构草稿和未确认任务回执有兼容读取；未确认请求不会因改名自动重发。新环境变量使用 DSH_LANGGRAPH_CANVAS_PYTHON，已有 LANGCONTOUR_PYTHON、VIS4AGENT_PYTHON 仍依次作为后备。当前开发机工作目录保持原路径可用，新克隆目录为 dsh-langgraph-canvas。

## 开发和检查

```powershell
npm.cmd run dev
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run acceptance:preflight
```

独立浏览器预览用于前端开发，没有 Harness 当前会话时不会自动调用模型。插件预检使用隔离副本，不代表真实账号的解释质量或 Electron 桌面验收。

## 项目结构

```text
apps/frontend/          React 图画布与编辑界面
apps/backend/           HTTP/SSE、项目管理和修改事务
services/python-worker/ Python 静态分析、证据校验和源码转换
packages/               数据协议、API 客户端和扩展接口
plugins/harness/        Harness 宿主与客户端接入
extensions/             MCP、RAG、Tools、Skills 的后续扩展位置
examples/               可用于试用的 LangGraph 示例
docs/                   设计、API、协作与交付说明
```

MCP、RAG、Tools、Skills 当前预留接口和目录，尚未全部实现。静态解析支持常见跨文件构图和有限注册循环，不能恢复任意 Python 动态程序；部分图或 AI 推断图会保持只读。

## 文档与反馈

- [主设计与开发计划](PROJECT_PLAN.md)
- [使用与首轮测试指南](USER_GUIDE.md)
- [开发交接](docs/DEVELOPMENT_HANDOFF.md)
- [公开发布与安装边界](docs/GITHUB_PUBLICATION.md)
- [提交问题](https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas/issues)

GitHub 仓库使用官方要求的 `dsh-plugin` topic，并附 `deepseek-harness`、`langgraph` 等主题。标签用于发现，不代表官方认证或桌面兼容性保证。原始运行日志、截图、会话缓存与本机配置不随源码上传；历史交接文档中的相关附件可能只在开发机保留。

## License

[MIT](LICENSE)。本仓库的 MIT 许可不授予任何第三方商标或官方背书；第三方依赖保留各自许可。参见 [第三方许可](THIRD_PARTY_NOTICES.md) 与 [版权和品牌核查](docs/IP_AND_BRAND_REVIEW.md)。
