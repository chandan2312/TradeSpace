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
5. **Unified Timezone Protocol**: All timestamps across feeds and storage are UTC epoch instants. All trading sessions, killzones, and daily candle boundaries are Europe/Athens (`EET/EEST = UTC+2/UTC+3`). Never perform naive modulo arithmetic (`time % 86400`) or call `date.getUTCHours()` for sessions; always import from `lib/time.js`.
6. **Golden Backtest Protocol**: All strategy audits and backtests must strictly use the canonical `lib/autonomous/replayDriver.js` which drives the live engine. Never write custom vectorized simulation loops or ad-hoc `simulateTrade()` scripts that cause lookahead and peeking bugs. For experiments, create an explicit copy of the replay driver.

Read `AGENTS.md` before executing tasks!
