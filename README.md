# Skatteverket Stateful Actor and KV services

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

Provision the native namespace with `telnyx-edge storage kv create --name skatteverket-voice-state`,
copy `telnyx.toml.example` to `telnyx.toml`, replace the namespace ID, then deploy:

```bash
telnyx-edge ship
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

The native `STATE_KV` binding is used for KV records; the Actor does not need an API key.

```text
GET    /keys/:key
PUT    /keys/:key   { "value": object, "ttl_seconds": number }
DELETE /keys/:key
```

The Python function calls this Actor for session mutations and uses the same
namespace for callback/live queue records.

For the native deployment, add the provisioned namespace ID to
`telnyx.toml` under `[storage.kv.STATE_KV]`; the Actor reads it through the
runtime binding and does not need an API key.

After deploying the Actor, set the Python function's `ACTOR_BASE_URL` to the
Actor URL and use the same namespace ID in `KV_NAMESPACE_ID`.
