# vis4agent

面向 **DeepSeek Harness 桌面端**的 LangGraph 可视化开发插件。直接读取工作区里的 Python 源码，在会话的“架构”视图中查看 State、节点、条件分支与图间调用，并通过草稿、差异审阅和确认应用来修改项目。

当前为开发预览版，Harness 插件版本 **0.6.7**。本项目是社区插件。

## 可以做什么

- 识别跨文件 LangGraph 定义，默认展示业务图，文档／示例图按需显示。
- 将 State 放在画布左上角；条件路由显示为菱形，图调用显示为双竖线框。
- 点击“展开子图”进入目标图，再沿实际进入路径返回，恢复原图视角与临时布局。
- 标准模式用 AI 生成的中文功能名和通俗说明；专业模式保留源码原函数名。
- 使用当前 Harness 会话及所选模型自动补充缺失版本的只读 AI 解析，复用缓存和后台任务；失败／取消后可手动重试。
- 编辑节点、连线、State 和节点职责，先保留草稿，再审阅差异、确认应用或撤销。

普通静态解析不执行用户 Python 模块。AI 解析会消耗当前会话的模型额度，需在当前会话选择可用模型；自动解析不会自动应用源码修改。证据校验能核对已读文件和行号，不能保证模型解释的语义完全正确。

## 安装到 DeepSeek Harness

需要 **Node.js 24+、Python 3.11+** 和可运行的 DeepSeek Harness 桌面端。源码解析无需安装 LangGraph。

本仓库是前后端与 Python worker 共存的 monorepo，插件入口在 `plugins/harness`。请先克隆、构建，再以本地链接安装该子目录；不要把仓库根目录当成独立 bundle 直接安装。

```powershell
git clone https://github.com/Cantarella-Fisalia/vis4agent.git
cd vis4agent
npm.cmd ci
npm.cmd run build
$pluginPath = (Resolve-Path ./plugins/harness).Path.Replace('\', '/')
dsh plugin --profile desktop add "link:$pluginPath"
```

如 `dsh` 不在 PATH，请使用桌面应用自带的 DSH CLI 执行相同的插件命令。完全退出并重开桌面，进入项目工作区，在“对话／轨迹”旁打开“架构”。插件共用当前工作区目录，主题跟随 Harness。

如机器上存在多个 Python 版本，可在启动 Harness 的环境中设置 `VIS4AGENT_PYTHON` 指向 Python 3.11+。详细操作和限制见 [使用指南](USER_GUIDE.md)。

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
- [提交问题](https://github.com/Cantarella-Fisalia/vis4agent/issues)

GitHub 仓库使用官方要求的 `dsh-plugin` topic，并附 `deepseek-harness`、`langgraph` 等主题。标签用于发现，不代表官方认证或桌面兼容性保证。原始运行日志、截图、会话缓存与本机配置不随源码上传；历史交接文档中的相关附件可能只在开发机保留。

## License

[MIT](LICENSE)
