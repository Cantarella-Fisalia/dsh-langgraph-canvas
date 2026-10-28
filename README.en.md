# vis4agent

<p align="center">
  <a href="README.md">简体中文</a> | <strong>English</strong>
</p>

A LangGraph visual development plugin for **DeepSeek Harness Desktop**. Read Python source files from your workspace, inspect State, nodes, conditional branches, and graph calls in the conversation's architecture view, and update your project through drafts, diff review, and confirmed changes.

Currently in developer preview. Harness plugin version: **0.6.7**. This is a community plugin.

## Features

- Discover LangGraph definitions across files. Show application graphs by default, with documentation and example graphs available on demand.
- Keep State in the upper-left corner of the canvas. Display conditional routing as diamonds and graph calls as boxes with double vertical borders.
- Use the subgraph button to navigate to the target graph, then return along your actual navigation path while restoring the original viewport and temporary layout.
- Standard mode uses AI-generated Chinese labels and plain-language explanations; professional mode preserves original function names from the source.
- Automatically supplement missing analysis for the current source revision using the current Harness conversation and its selected model. Reuse cached results and running tasks, with manual retry after failure or cancellation.
- Edit nodes, edges, State, and node responsibilities. Keep changes as drafts before reviewing diffs, confirming application, or undoing changes.

Static analysis does not execute user Python modules. AI analysis uses the current conversation's model quota and requires an available model in that conversation. Automatic analysis does not automatically apply source changes. Evidence validation checks the files and line ranges that were read; it cannot guarantee that model explanations are semantically correct.

## Install in DeepSeek Harness

Requires **Node.js 24+**, **Python 3.11+**, and a working DeepSeek Harness Desktop installation. LangGraph does not need to be installed for source analysis.

This repository is a monorepo containing the frontend, backend, and Python worker. The plugin entry point is in `plugins/harness`. Clone and build the full repository, then install that subdirectory as a local link. The repository root is not a standalone installable bundle.

```powershell
git clone https://github.com/Cantarella-Fisalia/vis4agent.git
cd vis4agent
npm.cmd ci
npm.cmd run build
$pluginPath = (Resolve-Path ./plugins/harness).Path.Replace('\', '/')
dsh plugin --profile desktop add "link:$pluginPath"
```

If `dsh` is not on PATH, run the same plugin command using the DSH CLI bundled with the desktop application. Fully quit and reopen the desktop application, open your project workspace, and select “架构” (Architecture) beside the conversation and trace tabs. The plugin shares the current workspace directory and follows the Harness theme.

If multiple Python versions are installed, set `VIS4AGENT_PYTHON` in the environment used to launch Harness to point to Python 3.11+. See the [user guide](USER_GUIDE.md) for detailed instructions and limitations. The interface and the linked guides are currently in Chinese.

## Development and checks

```powershell
npm.cmd run dev
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run acceptance:preflight
```

The standalone browser preview is intended for frontend development. It does not automatically call a model without a current Harness conversation. Plugin preflight checks use isolated copies; they do not verify explanation quality with your model account or replace Electron desktop acceptance testing.

## Project structure

```text
apps/frontend/          React graph canvas and editing interface
apps/backend/           HTTP/SSE, project management, and change transactions
services/python-worker/ Python static analysis, evidence checks, and source transforms
packages/               Data contracts, API client, and extension interfaces
plugins/harness/        Harness host and client integration
extensions/             Extension points for MCP, RAG, Tools, and Skills
examples/               LangGraph examples for trying the plugin
docs/                   Design, API, collaboration, and handoff documentation
```

MCP, RAG, Tools, and Skills currently have reserved interfaces and directories; they are not all implemented. Static analysis supports common cross-file graph construction and limited registration loops, but cannot reconstruct arbitrary dynamic Python programs. Partial graphs and AI-inferred graphs may remain read-only.

## Documentation and feedback

- [Design and development plan](PROJECT_PLAN.md)
- [User guide and first-run testing](USER_GUIDE.md)
- [Development handoff](docs/DEVELOPMENT_HANDOFF.md)
- [Public release and installation scope](docs/GITHUB_PUBLICATION.md)
- [Report an issue](https://github.com/Cantarella-Fisalia/vis4agent/issues)

The repository uses the `dsh-plugin` topic required for discovery, together with topics such as `deepseek-harness` and `langgraph`. Topics support discovery and do not imply official endorsement or guaranteed desktop compatibility. Raw runtime logs, screenshots, conversation caches, and local configuration are excluded from the repository. Some attachments referenced by historical handoff documents may only be available on the development machine.

## License

[MIT](LICENSE)
