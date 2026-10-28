# 扩展预留

契约位于 packages/extension-sdk/src/index.ts。MCP、RAG、Tools、Skills 当前均未接入。
后续实现分别放在 mcp/、rag/、tools/、skills/；开发助手与项目运行绑定独立配置。
当前 API 返回预留能力状态，不执行外部服务或保存凭据。
