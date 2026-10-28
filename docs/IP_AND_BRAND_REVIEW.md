# 版权、开源许可与品牌使用核查

项目：dsh-langgraph-canvas。核查日期：2026-10-28。范围：当前拟公开源码、声明、依赖锁文件与官方公开规则。本文记录初步合规检查，不是完整代码溯源审计、商标检索或法律意见，不保证零风险。

## 初步判断

没有从所查开源许可证及当前可见仓库发现明显的代码许可冲突；这一判断不能推导为“名称已获商标授权”或“免责声明可以免除侵权责任”。是否侵权仍取决于具体使用、授权范围、司法辖区和未核实事实。

## 官方来源与结论

| 对象 | 已核实事实 | 本项目的处理 |
| --- | --- | --- |
| DeepSeek Harness 源码 | [官方 LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE) 为 MIT，复制或再分发相关代码需保留版权和许可文本 | 当前可发布树未发现整包内核或 SDK 源码被 vendoring；通过宿主接口集成。未来复制官方代码仍需保留其声明 |
| DeepSeek 品牌 | [官方品牌指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md) 建议关联项目使用 DSH 缩写；允许准确说明兼容关系，要求避免把完整官方品牌当作项目名或制造官方背书印象 | 使用用户选定的 dsh- 前缀，以第三方插件身份展示，不使用官方图标或认证式描述 |
| DeepSeek 服务条款 | [用户协议](https://www.deepseek.com/harness/terms-of-use/) 知识产权条款另有品牌限制，并保留依法或开源授权取得的权利 | 不把开源代码许可扩张为商标许可，也不把服务条款当作源码许可证的替代物 |
| LangGraph 源码 | [官方 LICENSE](https://github.com/langchain-ai/langgraph/blob/main/LICENSE) 为 MIT | 示例仅导入兼容目标，项目不捆绑其框架；未来复制代码时保留 LangChain 原版权与许可 |
| LangChain／LangGraph 品牌 | [官方品牌资产说明](https://www.langchain.com/brand-assets) 规定标志使用方式，并禁止制造官方主办／支持印象；此页面不等于对任何第三方项目名称的普遍书面商标授权 | 不使用官方 Logo，README 和插件状态页明确独立、非官方。名称中 LangGraph 的使用作为功能兼容指示，但仍不能保证获得商标授权或不存在混淆争议 |
| 当前浏览器依赖 | 本机锁定的非 dev 依赖项标明 MIT、ISC 或 BSD-3-Clause | 增补原始许可文本及清单，并在生产前端构建中携带，避免仅放项目自己的 MIT LICENSE |

所查 LangChain 网站服务条款针对 LangSmith Platform，不能拿来认定本项目获准使用 LangGraph 商标，也不能用来覆盖 LangGraph 开源许可。本文没有把第三方商标查询网站作为授权证明。

## 已执行措施

1. 中英文 README 顶部、使用指南、插件状态页和仓库描述明确：独立社区项目，与 DeepSeek／DeepSeek Harness 及 LangChain／LangGraph 官方无隶属、合作、赞助或背书关系。
2. 不复制官方 Logo、图标、认证徽章或营销页面。当前公开树未跟踪图片素材；本机历史截图继续忽略。接口主题适配用于随宿主显示，不表示项目拥有宿主界面资产。
3. 本项目自身 MIT LICENSE 保留作者声明；第三方通知和原许可文本单独保存，尊重各许可中的版权、免责声明及 BSD 不背书条款。
4. dsh-plugin topic 仅表示发现入口，不宣称通过官方认证或市场审核。

## 尚不能确认的事项

- 未取得针对 dsh-langgraph-canvas 这个具体复合名称的书面商标授权；DSH 命名建议降低与官方混淆的风险，但不能替代 LangGraph 名称方面的权利核查。
- 未审计完整开发历史、AI 生成片段的来源、全部司法辖区的商标或专利；未验证未来截图、Logo、发布包、模型输出或用户业务代码的授权。
- 当前许可清单是锁文件非 dev 依赖的保守范围，不等于所有构建工具的再分发清单。分发 node_modules、构建工具、宿主内核或其他素材时需扩大核查。

若收到权利人异议，应先核对具体主张及使用范围，必要时调整标识／素材或取得授权。商业品牌注册、授权争议或收费推广应请熟悉相关司法辖区的专业人士复核。README 声明是减少混淆的措施，不是法律免责承诺。
