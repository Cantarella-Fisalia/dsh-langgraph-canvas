# DISTRIBUTION-002：添加插件入口查找失败

日期：2026-10-29。负责方：甲方。范围：中英文 README、安装指南、分发说明、主计划与交接文档。用户明确使用“添加插件”输入框，而非配置索引后的 Discover 搜索。无业务代码／协议／版本变动；不修改生产 profile。

诊断：裸包名由 pluginManager.inspect 向 npm registry 查询。DISTRIBUTION-001 交付 GitHub Git／tgz 与 Discover 索引，未发布 npm 包，故不能把“索引可搜索”当成“输入裸名称即可安装”。

2026-10-29 再次使用官方 0.2.1-rc.3 parseMarketIndex／pluginMarket.search 读取公开索引，按插件名、LangGraph、画布均返回 0.9.0。此前已验证的完整 Git 安装地址：

`git+https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas.git#4b10bde325490e64151b390112235c7b19143e64`

本批补齐“添加插件”直接粘贴固定 Git 地址和“Discover 添加索引后搜索”两条独立路径。官方依据：[插件管理界面](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.md)、[市场指南](https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market)。

npm whoami 在默认和实际用户环境均返回 ENEEDAUTH。若要求裸名称安装，需项目负责人先完成 npm 登录，再由甲方发布已验证的完整 tarball；不能上传源码子包代替，也不能承诺镜像立即同步。没有发起 npm 登录、注册账号或发布未获认证的软件包。

状态：入口诊断与文档修正完成；Git／tgz 安装可用，裸包名安装等待 npm 认证与发布。只改文档，校验安装地址与已验证发行提交一致，无需重跑业务测试。乙方未提交 integration/BRAND-RENAME-001.md 保持不动。
