# PYTHON-RUNTIME-001：解释器一致性与版本诊断修复

2026-10-24，甲方负责。状态：已交付，主功能回归通过。依据用户转交的乙方 [HARNESS-COMPLETE-001 验收](../integration/HARNESS-COMPLETE-001.md)；乙方原文件未修改。主计划 0.17。

## 修复内容

- 新增共享 scripts/runtime/python.mjs 与 TypeScript 声明，宿主与直接创建的 PythonWorker 共用：显式 pythonCommand → LANGCONTOUR_PYTHON → 已存在的 D:/Anaconda/python.exe → PATH python。环境变量支持命令名；显式错误不静默回退。
- Worker 启动前使用 -I -S 仅读取 sys.version_info/sys.executable，不导入用户项目或 sitecustomize，要求 Python 3.11+。版本不符返回 503 / PYTHON_VERSION_UNSUPPORTED，消息带实际路径、版本与环境变量设置指引。找不到解释器／启动失败为 PYTHON_START_FAILED；另有探测超时或无效输出的明确错误。
- 并发首请求共用一次启动检查；关闭时取消探测，不在卸载后迟到启动 worker。后续源码请求协议未改变。
- npm test 改为 scripts/dev/test.mjs：先探测并输出实际解释器，再令 Node 检查和 Python unittest 共用同一可执行文件。无新依赖或锁文件变更。
- adapter 和行为任务的检查初始化先断言 /projects 成功，错误响应直接显示，不再以 undefined.graphs 遮盖根因。
- README、USER_GUIDE、主计划和开发交接同步。未修改桌面 profile、默认模型或乙方记录，未重启任何 Harness 实例。

## 复现与验证

本终端原始 PATH 首项是 D:/Anaconda/python.exe（3.12.3），但同时存在 Python37-32/python.exe（3.7.9）。按乙方场景在子命令内把 3.7.9 目录放在 PATH 首位并清除 LANGCONTOUR_PYTHON：

1. python --version 确认为 3.7.9；npm test 输出实际选用 D:/Anaconda/python.exe 3.12.3，67 项全通过（33 Node + 34 Python）。
2. 同样的 PATH 下直接 node --test plugins/harness/tests/behavior-adapter.test.mjs，7 项通过，证明直接 createApplication 也有统一兜底。
3. 显式把 LANGCONTOUR_PYTHON 指向实际 3.7.9，npm test 在 Node 检查开始前退出 1，明确打印 PYTHON_VERSION_UNSUPPORTED、3.7.9、需要 3.11+ 和修复提示。此为预期拒绝，不计为回归失败。
4. 新增真实旧解释器 API 检查：createApplication({pythonCommand: 3.7.9路径}) 的 /projects 返回 503 / PYTHON_VERSION_UNSUPPORTED，尚未导入 worker 的业务模块；缺失解释器也返回明确 503。
5. 选择顺序、版本边界、并发 worker 首请求、关闭期间探测取消等新增 6 项检查通过。类型检查、生产构建和默认插件预检通过。

67 项是在本机旧解释器存在的条件下无跳过全部通过；其他机器没有此特定旧解释器时，仅那项旧版本实机检查跳过，版本边界的通用检查仍执行。

## 使用

用户无需为了本机兜底修改系统 PATH。需要手动配置时，把 LANGCONTOUR_PYTHON 指向 Python 3.11+ 后重启对应后端或桌面宿主。当前目录链接方式仍适用；本轮宿主代码改变，桌面仍需完全退出再重新打开。

本修复只解决运行环境一致性，不改变已交付的结构编辑／行为生成／独立确认应用与撤销流程；真实模型账号和桌面交互仍按原计划由用户试用反馈。
