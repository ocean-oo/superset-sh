# V2 Notification Hooks: Client-Side Playback

Shipped in PR #3675.

## Goal

Play the agent finish sound + sidebar status on the renderer instead of electron main, so v2 notifications work when the host-service is off-machine. Keep v1 feature parity: ringtone playback, volume/mute, pane-visibility suppression, sidebar working/permission/review indicator.

## Flow

```text
agent shell hook (notify.sh)
   │ POST /trpc/notifications.hook (no auth)
   ▼
host-service
   ├── mapEventType() normalizes to Start/Stop/PermissionRequest
   └── EventBus.broadcastAgentLifecycle → all connected WebSocket clients
                          │
                          ▼
renderer (desktop electron — web later)
   ├── useV2AgentHookListener per open v2 workspace (mounted at _authenticated/layout.tsx)
   ├── updatePaneStatus — writes working/permission/review to useV2PaneStatusStore
   ├── shouldSuppress — skip ringtone if user is viewing + window focused
   ├── playRingtone — HTMLAudioElement with v1's 11 bundled mp3s
   └── new Notification(...) — native OS toast
```

Electron main's v1 hook server (`apps/desktop/src/main/lib/notifications/server.ts`) stays running for v1 terminals. The shell script prefers the v2 host-service endpoint when `SUPERSET_HOST_AGENT_HOOK_URL` is set, falls back to v1 on missing URL or non-2xx response.

## What shipped

### host-service

- **`packages/host-service/src/events/map-event-type.ts`** — ported from `apps/desktop/src/main/lib/notifications/map-event-type.ts` (duplicated per v1/v2 memory). Start / Stop / PermissionRequest.
- **`packages/host-service/src/events/types.ts`** — `AgentLifecycleMessage` added to `ServerMessage`. Fields: `workspaceId`, `eventType`, optional `paneId`/`tabId`/`terminalId`/`sessionId`/`hookSessionId`/`resourceId`, `occurredAt`.
- **`packages/host-service/src/events/event-bus.ts`** — `broadcastAgentLifecycle()` public method; fans out to all connected sockets.
- **`packages/host-service/src/trpc/router/notifications/`** — `notifications.hook` mutation. **`publicProcedure`** — intentionally unauthenticated, the endpoint only broadcasts chimes (no state change, no data access). See router comment for rationale.
- **`packages/host-service/src/types.ts`** + **`app.ts`** — `eventBus` added to tRPC context.
- **`packages/host-service/src/terminal/env.ts`** + **`terminal.ts`** — injects `SUPERSET_HOST_AGENT_HOOK_URL` (`http://127.0.0.1:$HOST_SERVICE_PORT/trpc/notifications.hook`) into v2 PTY env. No token — endpoint is unauth.

### workspace-client

- **`packages/workspace-client/src/lib/eventBus.ts`** — `AgentLifecyclePayload` type, `on("agent:lifecycle", ...)` handling.
- **`packages/workspace-client/src/index.ts`** — re-exports `AgentLifecyclePayload`.

### renderer

- **`apps/desktop/src/renderer/hooks/host-service/useWorkspaceEvent/`** — overload for `"agent:lifecycle"`.
- **`apps/desktop/src/renderer/lib/ringtones/{play,urls}.ts`** — `playRingtone()` + `primeRingtoneAudioOnFirstGesture()` (idempotent, survives mount churn, retries both pointer + keyboard on failure). 11 built-in mp3s bundled via `new URL(..., import.meta.url)`.
- **`apps/desktop/src/renderer/stores/v2-pane-status/`** — `useV2PaneStatusStore` (`Record<paneId, { workspaceId, status }>`). V2 panes don't live in v1's `useTabsStore`, so status needs its own store. `selectWorkspaceStatus(id)` aggregates by workspace for the sidebar.
- **`apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2AgentHookListener/`** — subscribes via `useWorkspaceEvent`, updates the pane-status store, plays the ringtone, shows the notification. Key fallback: `firstNonBlank(paneId, terminalId, sessionId, hookSessionId, resourceId)` — v2 terminals only expose `terminalId`, and agents send empty strings (not undefined) for missing fields, so plain `??` was wrong.
- **`apps/desktop/src/renderer/routes/_authenticated/components/V2AgentHookListeners/`** — mounts one listener per open v2 workspace at the authenticated layout level so backgrounded workspaces also receive events. Multiple listeners against the same host reuse one WebSocket (O(1 socket per host), not per workspace).
- **`apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/page.tsx`** — `useClearPaneAttentionOnView` clears review statuses when the user is on the workspace page, and re-runs when a new review arrives in-place.

### dashboard sidebar

- **`DashboardSidebarWorkspaceItem`** subscribes via `useV2PaneStatusStore(selectWorkspaceStatus(id))` and passes the status through to the expanded row and collapsed button.
- **`DashboardSidebarWorkspaceIcon`** already had the dot overlay; it was just receiving `null`. Now gets the real status → same visual as v1 (amber spinner when working, red pulse on permission, static green on review).

### agent shell hook

- **`apps/desktop/src/main/lib/agent-setup/templates/notify-hook.template.sh`** — added a v2 branch that POSTs to `$SUPERSET_HOST_AGENT_HOOK_URL` with the tRPC single-call body shape (`{"json": {...}}`). Captures the HTTP status; exits only on 2xx. Falls through to the v1 electron endpoint on non-2xx, timeout, or missing URL.

## Key decisions

- **No auth on `notifications.hook`.** The endpoint only broadcasts chimes — no code execution, no data, no state change. Reusing the global `HOST_SERVICE_SECRET` as a bearer was both theater (same secret already sits in a user-readable manifest alongside `HOST_SERVICE_SECRET`) and a leak vector (PTY env exposure to every agent subprocess). Unauthenticated is the right posture for this specific endpoint; re-introduce auth only if capabilities grow.
- **V2 pane status in a separate store.** V2 panes live in `@superset/panes` (a workspace-scoped layout store with no `status` field). Piggybacking on v1's `useTabsStore` wouldn't work because v2 paneIds aren't registered there. `useV2PaneStatusStore` parallels the layout and filters by workspaceId for the sidebar selector.
- **`terminalId` as the fallback key.** V2 terminals set `SUPERSET_TERMINAL_ID` but not `SUPERSET_PANE_ID` — panes are a client-only concept in v2. The status key falls through `paneId → terminalId → sessionId → hookSessionId → resourceId`, treating empty strings as missing.
- **Listener at the layout, not per-page.** Mounted once on `_authenticated/layout.tsx` per v2 workspace via `V2AgentHookListeners`. Backgrounded workspaces still flash the sidebar dot. Matches v1's global `useAgentHookListener`.

## Out of scope (follow-ups)

- **Postgres-synced prefs.** Renderer still reads `notificationVolume` / `notificationSoundsMuted` / `selectedRingtoneId` via electron-trpc from local-db. Fine for desktop-only usage. Migrating to Postgres `userSettings` is phase 3 of the original plan; ship when the web client needs pref sync.
- **Custom ringtones.** v1 supports a single custom `.mp3` on local filesystem. V2 treats `"custom"` id as fallback-to-default for now. To ship: R2 upload + IndexedDB cache + one-shot local→R2 migration. Gate on telemetry — check if anyone actually used the feature before investing.
- **Web client.** apps/web doesn't subscribe to host-service events yet; this PR only wires the electron renderer. Same hooks should work for web once it has a host-service connection — the rendering path is already web-compatible (no electron IPC).
- **Cross-device dedup.** If a user has two devices open on the same workspace, both chime. Acceptable — same as email notifications.
- **Cross-tab dedup.** If the web client ever gets opened in two tabs, both would chime. Plan mentions `BroadcastChannel` leader election; skip until it's a real problem.
- **Missed events while disconnected.** WebSocket is lossy on reconnect. Fire-and-forget is acceptable for chimes; add `since` cursor replay only if users complain.
- **Retiring v1.** Electron main's hook server, `play-sound.ts`, and `custom-ringtones.ts` stay for v1 terminals. Delete when v1 UI is sunset (see `project_v1_sunset`).

## Related

- **Review fixes** (PR #3675 commits after initial): v2 route regex in `isCurrentWorkspace`; v2 suppression fallback when paneId/tabId absent; `firstNonBlank` for the `Notification` tag too; `WorkspaceListener` split to its own file; `useClearPaneAttentionOnView` re-runs on status changes; autoplay priming idempotent + keyboard-retry preserved.
- **Security review:** dropped `HOST_SERVICE_SECRET` from PTY env alongside the auth drop. Any new host-service capability added to the hook endpoint must re-evaluate auth.
