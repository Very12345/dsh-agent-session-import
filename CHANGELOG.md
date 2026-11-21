# Changelog

## 0.3.0-very12345.1 — personal fork

- Reuse Codex's own context boundaries. Codex records each completed compaction as a `compacted` rollout line carrying the surviving replacement history and a window number; the importer now reads the newest one and emits a matching DSH `compaction/start` + `compaction/summary` pair.
- Full history is still written: the compaction only adds a shadow list, so every imported message stays readable while a resumed model sees the same bounded window Codex itself kept.
- A boundary whose surviving tail holds no real dialogue (only environment or developer instructions) is ignored rather than producing an empty-looking session.
- Sessions stored through Codex's paginated history path carry only a compaction id and no replacement history, so they cannot be reused; those import in full without a boundary.

## 0.2.9-very12345.1 — personal fork

- Expand Codex's private `:codex-file-citation{path="..." purpose="..."}` directive into a Markdown link whose text is the file name. DSH has no such directive, so an imported transcript previously showed the raw braces and attributes in the middle of an answer. Spaces in the path are percent-encoded so the link stays valid.
- Already-imported sessions keep their stored text; reimport a conversation to pick this up.

## 0.2.8-very12345.1 — personal fork

- Fence tool output in resume-safe mode. Codex returns diffs and source files whose lines start with `#`; flattening them into a paragraph made DSH render a Python comment such as `# R200 visual disk ...` as a document heading and squeeze the surrounding code into an unreadable line. Tool results are now wrapped in a fence longer than any backtick run inside them, with a `diff` tag when the content is a patch.
- Quote reasoning summaries so heading-like lines inside them stay literal instead of restyling the page.
- Already-imported sessions keep their stored shape; reimport a conversation to pick up the improved rendering.

## 0.2.7-very12345.1 — personal fork

- Fix Codex project grouping: Codex stores cwds with the Windows extended-length prefix (`\\?\D:\...`), which never matched a project root and turned every run directory (`fast-r3`, `best-r3`) into its own pseudo project. The prefix is now stripped before matching.
- Classify Codex threads and let the panel filter them: conversations, automation runs (`exec` batch runs, guardian reviews, agent-created threads) and subagent threads are separated instead of mixed together.
- Add an archived filter (hide / include / only) so archived rollouts no longer look like duplicate conversations.
- Render Codex `exec` programs as readable code: the program is exposed under `command`/`code` instead of an escaped JSON string, in both faithful and resume-safe modes.

## 0.2.6-very12345.1 — personal fork

- Read Codex desktop project assignments, explicit thread names and the archived rollout directory; show missing local transcripts without offering an invalid import.
- Reconstruct locally available paginated conversations from Codex thread-history SQLite when no JSONL rollout is present.
- Register selected Codex projects through the official DSH workspace service and attach newly created sessions. Existing imports are not overwritten.
- Format Codex execution and wait arguments as readable code; remove known synthetic page-context wrappers while preserving user text around them.
- Mark images whose original data is not imported and preserve visible agent-to-agent messages.
- Validate with isolated Codex fixtures and the official DSH Host/workspace registry; no live conversations or model requests are used.

## 0.2.5 — 2026-11-17

- Cursor: support Cursor 3.30's current composer storage and the newer `~/.cursor/projects/**/agent-transcripts/*.jsonl` store as one Cursor source.
- Cursor composer formats: decode `_v`, keep V3+ `toolFormerData`, and add V1 `capabilities[].data.bubbleDataMap` fallback (object and JSON-string forms).
- Cursor 3.30 `/t:` and `/s:` sub-bubble records are read; sub-bubble conversations no longer report a fake zero message count.
- Cursor agent transcripts are parsed and listed; tool inputs are preserved as text because the transcript store has no tool results.
- Added Cursor V1/V3/sub-bubble and agent transcript tests (32 tests total); verified real Cursor 3.30.14 composer and transcript imports through an isolated DSH instance.

## 0.2.4 — 2026-10-21

- 重新发布到 npm。0.2.2 已被撤回，0.2.3 被 npm staged placeholder 占用，因此使用 0.2.4 发布。
- 功能与 0.2.2 一致；预发布检查、27 项测试与打包清单保持通过。

## 0.2.2 — 2026-10-20

- Host 导入服务拆分为 state/jobs/scan 模块，端点错误结构统一。
- Kimi 新增 Kimi Code CLI 会话目录（`~/.kimi-code` / `KIMI_CODE_HOME`），Windows/Linux 也可用。
- 跨平台支持：应用数据目录按 macOS / Windows / Linux 解析，cwd 使用 `path.isAbsolute`，SQLite 统一优先 `node:sqlite` 并提供 Windows 安全的 `file:` URI 回退。
- CI 覆盖 ubuntu-latest / macos-latest / windows-latest。
- 修正来源展示顺序为 Codex、Claude Code、Cursor、ZCode、Kimi，并更新界面预览截图。

## 0.2.1 — 2026-10-20

- 精简来源列表，仅保留开源工具的本地历史导入。
- 首次进入导入面板时显示加载状态（spinner + skeleton 占位），避免空白等待。

## 0.2.0 — 2026-10-20

首个公开版本。

- Sources: Codex (CLI and the Codex app bundled in ChatGPT.app share
  `~/.codex`), Claude Code, Cursor IDE (Agent/Composer), ZCode, and Kimi
  (Agent/Kimi Code).
- Sidebar panel with a source rail, conversations grouped by project folder,
  search, Unimported/All filter, group-level selection and a progress/results
  dialog with retry for failed imports.
- Two import modes: **Faithful** keeps reasoning/tool blocks as structured cards,
  **Resume-safe** keeps the same content as plain text so any model can resume.
- Imported sessions get a provenance note and an empty protected system head;
  sessions are written as v4 logs and their title projections are warmed.
- Provider plugin architecture: add a `lib/host/providers/<id>.js` module and one
  registry line to support another agent.
