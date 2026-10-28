# BUG-DESKTOP-JSON-BOM-001：桌面启动失败修复

日期：2026-10-23。状态：配置修复并通过 JSON 解析验证，等待桌面端重新启动验收。

用户本轮请求检查桌面启动故障，主功能侧据此执行一次限定范围的配置修复；未调整双方长期分工。

崩溃日志：C:/Users/31675/AppData/Roaming/@deepseek-ai/dsh-desktop/logs/crash-2026-10-23T06-45-41-312Z-host.log。
调用栈：JSON.parse → readProfileManifest → loadProfileDirectory。
根因：桌面 profile 的 package.json 首部为 EF BB BF，直接 JSON.parse 失败；移除 BOM 后配置本身有效。

修复文件：C:/Users/31675/.dsh/profiles/desktop/package.json
原始备份：C:/Users/31675/.dsh/profiles/desktop/package.json.bom-backup-2026-10-23T06-50-38-123Z
修复前 SHA256：c88721ec7c8ea849299060ba76b060c8387f077800e2b924a6e39b63ffa9dddc
修复后 SHA256：114c98f40fb0a6fbf53a25a7deb9c986768d07c8253c781555a1cc7c5c8604e4

检查：修复后字节与原文件去除前三字节完全相等；Node JSON.parse 通过。插件依赖、激活清单与其他配置内容保留。
本轮未修改插件代码，未重置 profile，未重装或自动重启桌面应用。

接入侧后续：重新启动桌面端，确认启动成功及 vis4agent 面板可用；如果出现其他错误，请提供新的日志。
写 JSON 文件时应显式使用不带 BOM 的 UTF-8；特别留意不同 PowerShell 版本的 UTF8 编码行为。
