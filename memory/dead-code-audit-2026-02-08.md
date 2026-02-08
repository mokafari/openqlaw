# Dead Code Analysis Report

**Generated:** 2026-02-08T00:23:43.535Z
**Files Analyzed:** 1780
**Total Exports:** 8640
**Dead Code Candidates:** 6239

## Summary

- 🔴 **High Confidence:** 3538 candidates (73622 lines)
- 🟡 **Medium Confidence:** 762 candidates (16623 lines)
- 🟢 **Low Confidence:** 1939 candidates (91928 lines)
- **Total Dead Code Lines:** 182173

## HIGH Confidence (3538 candidates)

### `Mutator` (class)

- **File:** src/agents/evolution/mutator.ts:98
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 941
- **Last Modified:** Sat Feb 07 2026

### `ContextGraph` (class)

- **File:** src/agents/aas/context-graph.ts:136
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 882
- **Last Modified:** Sat Feb 07 2026

### `applyAuthChoiceApiProviders` (function)

- **File:** src/commands/auth-choice.apply.api-providers.ts:60
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 742
- **Last Modified:** Thu Feb 05 2026

### `monitorDiscordProvider` (function)

- **File:** src/discord/monitor/provider.ts:143
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 533
- **Last Modified:** Thu Feb 05 2026

### `chatHandlers` (named)

- **File:** src/gateway/server-methods/chat.ts:186
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 524
- **Last Modified:** Sat Feb 07 2026

### `nodeHandlers` (named)

- **File:** src/gateway/server-methods/nodes.ts:65
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 473
- **Last Modified:** Thu Feb 05 2026

### `agentHandlers` (named)

- **File:** src/gateway/server-methods/agent.ts:45
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 471
- **Last Modified:** Thu Feb 05 2026

### `sessionsHandlers` (named)

- **File:** src/gateway/server-methods/sessions.ts:45
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 438
- **Last Modified:** Sat Feb 07 2026

### `BuildCacheAnalyzer` (class)

- **File:** src/agents/tools/build-cache.ts:83
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 413
- **Last Modified:** Sat Feb 07 2026

### `LEGACY_CONFIG_MIGRATIONS_PART_2` (named)

- **File:** src/config/legacy.migrations.part-2.ts:12
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 403
- **Last Modified:** Thu Feb 05 2026

### `AcpGatewayAgent` (class)

- **File:** src/acp/translator.ts:53
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 402
- **Last Modified:** Thu Feb 05 2026

### `TestDiscovery` (class)

- **File:** src/agents/tools/test-discovery.ts:82
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 396
- **Last Modified:** Sat Feb 07 2026

### `KnowledgeGraph` (class)

- **File:** src/agents/episodic/knowledge-graph.ts:57
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 389
- **Last Modified:** Sat Feb 07 2026

### `MutationWorkflow` (class)

- **File:** src/agents/evolution/mutation-workflow.ts:26
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 374
- **Last Modified:** Sat Feb 07 2026

### `handleAllowlistCommand` (named)

- **File:** src/auto-reply/reply/commands-allowlist.ts:323
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 373
- **Last Modified:** Thu Feb 05 2026

### `LEGACY_CONFIG_MIGRATIONS_PART_1` (named)

- **File:** src/config/legacy.migrations.part-1.ts:9
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 371
- **Last Modified:** Thu Feb 05 2026

### `DeadCodeAnalyzer` (class)

- **File:** src/tools/dead-code-analyzer.ts:37
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 368
- **Last Modified:** Sun Feb 08 2026

### `GitTools` (class)

- **File:** src/agents/evolution/git-tools.ts:77
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 328
- **Last Modified:** Sat Feb 07 2026

### `configHandlers` (named)

- **File:** src/gateway/server-methods/config.ts:89
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 328
- **Last Modified:** Thu Feb 05 2026

### `EpisodeStore` (class)

- **File:** src/agents/episodic/episode-store.ts:41
- **Reason:** No imports, no calls, not used by tests
- **Imports:** 0 | **Calls:** 0 | **Lines:** 327
- **Last Modified:** Sat Feb 07 2026

_... and 3518 more candidates_

## MEDIUM Confidence (762 candidates)

### `MemoryIndexManager` (class)

- **File:** src/memory/manager.ts:108
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 2248
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `QmdMemoryManager` (class)

- **File:** src/memory/qmd-manager.ts:51
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 760
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `monitorIMessageProvider` (function)

- **File:** src/imessage/monitor/monitor-provider.ts:159
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 635
- **Last Modified:** Sat Feb 07 2026
- **⚠️ Used by tests**

### `OpenClawSchema` (named)

- **File:** src/config/zod-schema.ts:90
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 536
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `monitorWebChannel` (function)

- **File:** src/web/auto-reply/monitor.ts:34
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 418
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `monitorWebInbox` (function)

- **File:** src/web/inbound/monitor.ts:25
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 379
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `GatewayClient` (class)

- **File:** src/gateway/client.ts:79
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 363
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `monitorSlackProvider` (function)

- **File:** src/slack/monitor/provider.ts:42
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 339
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `EmbeddedBlockChunker` (class)

- **File:** src/agents/pi-embedded-block-chunker.ts:27
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 294
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `MediaAttachmentCache` (class)

- **File:** src/media-understanding/attachments.ts:215
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 216
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `IMessageRpcClient` (class)

- **File:** src/imessage/client.ts:40
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 197
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `PluginRuntime` (type)

- **File:** src/plugins/runtime/types.ts:178
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 184
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `monitorSignalProvider` (function)

- **File:** src/signal/monitor.ts:275
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 126
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `monitorTelegramProvider` (function)

- **File:** src/telegram/monitor.ts:90
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 126
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `CampingManager` (class)

- **File:** src/agents/camping.ts:25
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 121
- **Last Modified:** Fri Feb 06 2026
- **⚠️ Used by tests**

### `MsgContext` (type)

- **File:** src/auto-reply/templating.ts:13
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 120
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `WizardSession` (class)

- **File:** src/wizard/session.ts:163
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 102
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `MemorySearchConfig` (type)

- **File:** src/config/types.tools.ts:224
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 101
- **Last Modified:** Sat Feb 07 2026
- **⚠️ Used by tests**

### `TelegramAccountConfig` (type)

- **File:** src/config/types.telegram.ts:44
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 98
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `ChatLog` (class)

- **File:** src/tui/components/chat-log.ts:7
- **Reason:** Only used by test files
- **Imports:** 0 | **Calls:** 0 | **Lines:** 98
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

_... and 742 more candidates_

## LOW Confidence (1939 candidates)

### `runEmbeddedAttempt` (function)

- **File:** src/agents/pi-embedded-runner/run/attempt.ts:146
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 950
- **Last Modified:** Sat Feb 07 2026
- **⚠️ Used by tests**

### `attachGatewayWsMessageHandler` (function)

- **File:** src/gateway/server/ws-connection/message-handler.ts:133
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 875
- **Last Modified:** Thu Feb 05 2026

### `registerTelegramHandlers` (named)

- **File:** src/telegram/bot-handlers.ts:41
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 866
- **Last Modified:** Thu Feb 05 2026

### `handleOpenResponsesHttpRequest` (function)

- **File:** src/gateway/openresponses-http.ts:330
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 585
- **Last Modified:** Thu Feb 05 2026

### `buildTelegramMessageContext` (named)

- **File:** src/telegram/bot-message-context.ts:126
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 568
- **Last Modified:** Sat Feb 07 2026
- **⚠️ Used by tests**

### `runAgentTurnWithFallback` (function)

- **File:** src/auto-reply/reply/agent-runner-execution.ts:54
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 549
- **Last Modified:** Thu Feb 05 2026

### `subscribeEmbeddedPiSession` (function)

- **File:** src/agents/pi-embedded-subscribe.ts:31
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 548
- **Last Modified:** Fri Feb 06 2026
- **⚠️ Used by tests**

### `prepareSlackMessage` (function)

- **File:** src/slack/monitor/message-handler/prepare.ts:49
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 535
- **Last Modified:** Thu Feb 05 2026

### `createSignalEventHandler` (function)

- **File:** src/signal/monitor/event-handler.ts:47
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 535
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `registerBrowserAgentActRoutes` (function)

- **File:** src/browser/routes/agent.act.ts:19
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 523
- **Last Modified:** Thu Feb 05 2026

### `createBrowserTool` (function)

- **File:** src/agents/tools/browser-tool.ts:220
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 505
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `registerBrowserManageCommands` (function)

- **File:** src/cli/browser-cli-manage.ts:23
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 499
- **Last Modified:** Thu Feb 05 2026

### `registerSlackMonitorSlashCommands` (function)

- **File:** src/slack/monitor/slash.ts:142
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 488
- **Last Modified:** Thu Feb 05 2026

### `runReplyAgent` (function)

- **File:** src/auto-reply/reply/agent-runner.ts:47
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 479
- **Last Modified:** Thu Feb 05 2026

### `finalizeOnboardingWizard` (function)

- **File:** src/wizard/onboarding.finalize.ts:52
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 470
- **Last Modified:** Thu Feb 05 2026

### `applyNonInteractiveAuthChoice` (function)

- **File:** src/commands/onboard-non-interactive/local/auth-choice.ts:42
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 467
- **Last Modified:** Thu Feb 05 2026

### `handleDiscordGuildAction` (function)

- **File:** src/agents/tools/discord-actions-guild.ts:42
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 466
- **Last Modified:** Thu Feb 05 2026

### `createCommandHandlers` (function)

- **File:** src/tui/tui-command-handlers.ts:48
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 453
- **Last Modified:** Thu Feb 05 2026
- **⚠️ Used by tests**

### `registerPluginsCli` (function)

- **File:** src/cli/plugins-cli.ts:99
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 451
- **Last Modified:** Thu Feb 05 2026

### `registerBrowserAgentStorageRoutes` (function)

- **File:** src/browser/routes/agent.storage.ts:6
- **Reason:** Minimal usage detected
- **Imports:** 0 | **Calls:** 1 | **Lines:** 430
- **Last Modified:** Thu Feb 05 2026

_... and 1919 more candidates_
