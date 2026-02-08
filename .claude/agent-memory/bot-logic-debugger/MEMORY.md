# Bot Logic Debugger - Agent Memory

## Comprehensive Analysis

📖 **See [BOT_LOGIC_ANALYSIS.md](./BOT_LOGIC_ANALYSIS.md)** for a complete walkthrough of the bot logic flow from user calls to sub-agent issuance.

🚀 **See [BOT_LOGIC_ANALYSIS_ENHANCED.md](./BOT_LOGIC_ANALYSIS_ENHANCED.md)** for performance analysis and enhancement ideas, including:

- Performance bottlenecks identified at each phase
- 20+ enhancement ideas with code examples
- Implementation priority recommendations
- Testing strategies
- Trade-offs and considerations

Both documents cover:

- Message reception & channel handling
- Routing & session resolution
- Gateway processing
- Agent runner & execution
- Tool execution & sub-agent spawning
- Sub-agent registry & lifecycle
- Announcement flow
- Security & isolation

## Quick Reference

### Key Source Locations

- **Message routing**: `src/routing/`
- **Tool factory**: `src/agents/tools/openclaw-tools.ts`
- **Before-tool hooks**: `src/agents/pi-tools.before-tool-call.ts`
- **FSM/State**: `src/agents/fsm/`
- **Evolution**: `src/agents/evolution/`
- **Dynamic tools**: `src/agents/tools/dynamic-registry.ts`
- **Sub-agent spawning**: `src/agents/tools/sessions-spawn-tool.ts`
- **Sub-agent registry**: `src/agents/subagent-registry.ts`
- **Sub-agent announcement**: `src/agents/subagent-announce.ts`

### Log Locations

- Agent sessions: `~/.openclaw/agents/<agentId>/sessions/*.jsonl`
- Gateway logs: `/tmp/openclaw-gateway.log`
- macOS unified: `./scripts/clawlog.sh`

### Common Debugging Commands

```bash
# Recent gateway errors
tail -100 /tmp/openclaw-gateway.log | grep -i error

# Session stats
tail -20 ~/.openclaw/evolution/stats/session_stats.jsonl | jq .

# Build + test
cd ~/openclaw && pnpm build && pnpm test
```

## Patterns & Gotchas

<!-- Add debugging patterns as you discover them -->

## Solved Issues

<!-- Record root causes of bugs you've fixed -->
