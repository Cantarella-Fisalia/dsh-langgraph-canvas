# dsh-langgraph-canvas

<p align="center">
  <a href="README.md">简体中文</a> | <strong>English</strong>
</p>

> **Unofficial project: independently maintained community software, not affiliated with, sponsored by, partnered with, or endorsed by DeepSeek, DeepSeek Harness, LangChain, or the LangGraph maintainers. Their names identify compatibility only. All third-party trademarks and copyrights belong to their respective owners.**


A LangGraph visual development plugin for **DeepSeek Harness Desktop**. Read Python source files from your workspace, inspect State, nodes, conditional branches, and graph calls in the conversation's architecture view, and update your project through drafts, diff review, and confirmed changes.

Currently in developer preview. Harness plugin version: **0.9.0**. This is a community plugin.

## Features

- Discover LangGraph definitions across files. Show application graphs by default, with documentation and example graphs available on demand.
- Keep State in the upper-left corner of the canvas. Display conditional routing as diamonds and graph calls as boxes with double vertical borders.
- Use the subgraph button to navigate to the target graph, then return along your actual navigation path while restoring the original viewport and temporary layout.
- Standard mode uses AI-generated Chinese labels and plain-language explanations; professional mode preserves original function names from the source.
- Automatically supplement missing analysis for the current source revision using the current Harness conversation and its selected model. Reuse cached results and running tasks, with manual retry after failure or cancellation.
- Edit nodes, edges, State, and node responsibilities. Keep changes as drafts before reviewing diffs, confirming application, or undoing changes.

Static analysis does not execute user Python modules. AI analysis uses the current conversation's model quota and requires an available model in that conversation. Automatic analysis does not automatically apply source changes. Evidence validation checks the files and line ranges that were read; it cannot guarantee that model explanations are semantically correct.

## Install in DeepSeek Harness

Requires **Node.js 24+, Python 3.11+** and DeepSeek Harness Desktop. Git-source installation also needs Git. The release includes the built frontend, backend, worker and license notices; no source checkout or build is required.

### Add plugin: paste the full installation address

In **Plugins → Add plugin**, paste this complete value, then install and enable the plugin:

```text
git+https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas.git#4b10bde325490e64151b390112235c7b19143e64
```

The bare name `dsh-langgraph-canvas` is **not available from npm yet**. That field resolves a package name through npm; it does not search our Discover index. The repository main branch is a source workspace, so keep the commit suffix above.

### Discover: add the index before searching

1. Open **Plugins → Experimental → More**, enable **Custom plugin markets**, then open **Discover**.
2. Choose **Add index source** and paste:

   `https://raw.githubusercontent.com/Cantarella-Fisalia/dsh-langgraph-canvas/main/market/index.json`

3. Search **dsh-langgraph-canvas** (or **LangGraph**), check the version and source, and choose **Install**.
4. Open a project workspace and select **Architecture** beside Chat / Trajectory. If the host requests a restart, fully quit and reopen it.

This is our independently hosted community index, readable by the official desktop. Adding it is a one-time step per profile; this is not a claim of default official catalog inclusion. See [distribution and installation](docs/DISTRIBUTION.md).

You can also download the prebuilt `.tgz` from [Releases](https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas/releases/latest) and use **Plugins → Add plugin** with its absolute local path. Set `DSH_LANGGRAPH_CANVAS_PYTHON` before launching Harness if you need to select a Python 3.11+ interpreter.

### Source development installation

The source repository root is a private workspace. Only the generated release root is an installable bundle. For local development:

```powershell
git clone https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas.git
cd dsh-langgraph-canvas
npm.cmd ci
npm.cmd run build
$pluginPath = (Resolve-Path ./plugins/harness).Path.Replace('\', '/')
dsh plugin --profile desktop add "link:$pluginPath"
```

## Upgrading from the previous name

The project was previously named LangContour and vis4agent. Its canonical name is now dsh-langgraph-canvas. If the old package is installed, remove its entry in Harness plugin management, link the new plugins/harness package using the instructions above, and fully restart the desktop application. Load only one version of the plugin.

Existing layouts, AI caches, behavior journals, and source transactions stay in the project's .vislang directory. Existing browser preferences, structure drafts, and uncertain task receipts remain readable; renaming never automatically resubmits an uncertain request. Use DSH_LANGGRAPH_CANVAS_PYTHON for new configuration; LANGCONTOUR_PYTHON and VIS4AGENT_PYTHON remain fallbacks, in that order. The existing development checkout stays accessible at its current location, while new clones use dsh-langgraph-canvas.

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
- [Report an issue](https://github.com/Cantarella-Fisalia/dsh-langgraph-canvas/issues)

The repository uses the `dsh-plugin` topic required for discovery, together with topics such as `deepseek-harness` and `langgraph`. Topics support discovery and do not imply official endorsement or guaranteed desktop compatibility. Raw runtime logs, screenshots, conversation caches, and local configuration are excluded from the repository. Some attachments referenced by historical handoff documents may only be available on the development machine.

## License

[MIT](LICENSE). This license grants no third-party trademark rights or official endorsement. Dependencies retain their own licenses. See [third-party notices](THIRD_PARTY_NOTICES.md) and the [copyright and branding review](docs/IP_AND_BRAND_REVIEW.md) (Chinese).
