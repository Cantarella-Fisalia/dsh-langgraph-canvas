# VIEW-MODE-001：标准模式与专业模式

2026-10-27，插件 v0.6.6，主计划 v0.26。甲方交付，待用户桌面试用。

用户要求提供适合初学者与熟练开发者的选项，名称固定为“标准模式”“专业模式”。顶部增加“显示模式”选择器，默认标准模式：以中文功能名和易懂职责为主。专业模式：主标题显示真实注册 ID，卡片补充函数／注册对象、中文别名和源码位置，条件边显示分支值。边端点、Inspector、State 读写关系与函数表同步切换。

两种模式共用同一份图与解读，不影响源码、注册 ID、编辑／审阅／应用权限，也不因切换重新调用 AI 或扫描源码。保留当前图、选中项与未保存布局。选择以 langcontour:view-mode 保存到当前宿主来源的 localStorage，架构视图重建时恢复；存储异常时当前页仍可切换，非法记录回退标准。不同来源之间不自动共享偏好，不承诺账号云同步。

涉及 apps/frontend/src/App.tsx、explanation-view.ts、canvas-state.tsx、function-table.tsx、styles.css、新增 view-mode.ts 和相应显示／偏好测试，以及插件版本与项目文档。仅更新宿主 lib/index.js 的版本常量及 package.json 版本，不修改宿主模型通道、生产 profile 或乙方记录；同步以摘要检查并发变动。

基础类型与回归检查通过，新增两项验证模式标签可逆且不改变图／解读、本机偏好重建恢复及存储拒绝／非法值回退。实际 E:/Heng/vis4agent 再次通过类型检查、137 项测试（82 Node＋55 Python）、生产构建和 11 项插件预检，预检实际加载 v0.6.6。报告 .tmp/acceptance/VIEW-MODE-001.json 摘要及修复源码摘要纳入证据；desktopAcceptance=not_performed，仍需用户 Electron 桌面试用。

本地真实前后端页面使用此前独立两节点合成示例及实际 worker 校验缓存，没有调用用户模型：从标准“检索资料”切换到专业 retrieve／retrieve_context／graph.py:5，函数表、边及已选节点详情同步更新；切回标准恢复中文。未保存布局按钮仍有效，四个节点的坐标与选中状态保持；新页面直接恢复专业模式。测试后恢复本地标准偏好，关闭两个临时标签页和开发服务。截图 API 返回 Unable to capture screenshot，仅保留结构化观察，不宣称像素或完整 Electron 桌面验收。

证据见 [VIEW-MODE-001-evidence.json](VIEW-MODE-001-evidence.json)。完全退出重开 Harness 加载新版，在架构页顶部切换显示模式即可；已有中文解读不需要重新生成。
