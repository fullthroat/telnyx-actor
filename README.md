## Skatteverket Stateful Actor and KV services

This is the state layer for the Python `skatt-voice` Edge Function.

- `CallSession` is the authoritative per-call state owner. The actor name is
  the `call_control_id` or `session_id`.
- Native Telnyx KV stores callback/live queue records and short-lived lookup
  data. It is deliberately not the authoritative active-call state.

The Actor follows Telnyx's documented `StatefulActor`, `ctx.storage`,
`idFromName`, and `[[actors]]` binding model.

## Deploy

Use a current `telnyx-edge` release with Stateful Actor support. The Telnyx
quick start states that CLI v0.2.2 and earlier cannot ship Actor projects.

```bash
telnyx-edge auth api-key set YOUR_TELNYX_API_KEY
telnyx-edge auth status
npm install
```

Provision the native namespace:

```bash
telnyx-edge storage kv create --name skatteverket-voice-state
```

Copy `telnyx.toml.example` to `telnyx.toml`, replace
`REPLACE_WITH_KV_NAMESPACE_ID` with the returned namespace ID, and keep the
Actor function UUID in the `[edge_compute]` block. Then deploy:

```bash
telnyx-edge ship
```

## Pre-call tests

Run the local contract tests:

```bash
npm test
```

After both services are deployed, run the end-to-end smoke test without a
phone call. It exercises Actor state, native KV writes, Edge Function
information handling, and MCP tool discovery:

```bash
export ACTOR_BASE_URL=https://YOUR_ACTOR_FUNCTION_URL
export EDGE_FUNCTION_URL=https://YOUR_EDGE_FUNCTION_URL
export MCP_AUTH_TOKEN=YOUR_MCP_TOKEN
npm test
```

Test the deployed Actor:

```bash
BASE=https://YOUR_ACTOR_FUNCTION_URL
curl "$BASE/health/liveness"
curl -X POST "$BASE/sessions/call-123/initialize" \
  -H 'content-type: application/json' \
  -d '{"language":"sv-SE","event_id":"e1"}'
curl "$BASE/sessions/call-123/state"
```

## State policy

The Actor stores active-call state: language, route, callback collection and
confirmation, queue IDs/status, event ID, and lifecycle timestamps. Do not put
secrets, tax knowledge, metrics, or the entire queue into an Actor.

The native `STATE_KV` binding stores callback and human-transfer records. The
Actor reads that binding through the runtime and does not need an API key.
The Actor uses its own `ctx.storage` for authoritative per-call state.

The Python function calls the Actor for session mutations and uses the same
namespace for callback/live queue records. After deploying the Actor, set the
Python function's `ACTOR_BASE_URL` to the Actor URL and use the same namespace
ID in `KV_NAMESPACE_ID`.

After deploying the Actor, set the Python function's `ACTOR_BASE_URL` to the
Actor URL and use the same namespace ID in `KV_NAMESPACE_ID`.
