# CLAUDE.md — TradeSpace

Project defaults for Claude / Gemini Code in this repo.

> **Agentic Framework**: This project uses a full multi-agent enterprise architecture.
> Read `AGENTS.md` for the complete agent hierarchy, global rules, and KI update protocol.
> That file is the single source of truth for all agent behavior.

## Workflow

1. **Default Orchestration**: Any new prompt is handled by `/orchestrator_lily` by default, who analyzes the prompt and delegates it to a specific department lead or micro-agent.
2. **Codebase Exploration**: Use `mcp_graphify_query_graph` or other graph tools as your primary discovery mechanism before falling back to grep/glob.
3. **Task Completion**: At the end of every significant task, the Knowledge Manager agent MUST update the project state KIs.
4. **Execution**: You must behave as the invoked agent. You take on their persona, skills, and restrictions as defined in their workflow markdown files inside `.agents/workflows/`.

Read `AGENTS.md` before executing tasks!
