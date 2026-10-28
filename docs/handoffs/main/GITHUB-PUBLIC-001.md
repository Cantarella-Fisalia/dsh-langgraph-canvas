# GITHUB-PUBLIC-001：首次公开 GitHub 发布

日期：2026-10-28。负责方：甲方。状态：准备发布。用户明确授权初始化／提交 Git 并上传公开 GitHub 仓库。

目标：https://github.com/Cantarella-Fisalia/vis4agent，公开；官方发现 topic 为 dsh-plugin。本批涉及 .gitignore、根及插件 package.json 元数据、锁文件的根 license、LICENSE、公开 README 与安装说明、主计划／交接记录，以及仓库级 Git 提交和 GitHub topics。不修改宿主运行代码或用户工作区。

根目录已有 Git 初始化，但无提交／远程。首个提交只包含经检查的源代码、测试、示例与公开文档；依赖、临时验证目录、会话缓存、调试 overlay、截图／原始运行附件不入库。保留本地文件，不执行删除或清理。

此仓库是 monorepo；安装需克隆完整仓库、npm ci、npm run build、link plugins/harness。不能用 GitHub topic 冒充一键安装能力。元数据沿用宿主 0.6.7，主计划更新 v0.32。认证、扫描、检查、提交与远程核验结果发布时补全。
