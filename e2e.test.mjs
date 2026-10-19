import test from "node:test";
import assert from "node:assert/strict";

const actor = process.env.ACTOR_BASE_URL?.replace(/\/$/, "");
const edge = process.env.EDGE_FUNCTION_URL?.replace(/\/$/, "");
const auth = process.env.MCP_AUTH_TOKEN;
const skip = !actor || !edge;

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { response, body };
}

async function json(url, options = {}) {
  const { response, body } = await requestJson(url, options);
  assert.equal(response.ok, true, `${url} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function expectStatus(url, status, options = {}) {
  const { response, body } = await requestJson(url, options);
  assert.equal(response.status, status, `${url} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const postBody = (value) => ({ method: "POST", body: JSON.stringify(value) });

test("deployed English and Swedish workflow scenarios without a phone call", { skip }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const english = `workflow-en-${suffix}`;
  const swedish = `workflow-sv-${suffix}`;
  const invalid = `workflow-invalid-${suffix}`;

  // Service reachability.
  assert.equal((await fetch(`${actor}/health/liveness`)).ok, true);
  assert.equal((await fetch(`${edge}/health/live`)).ok, true);

  // English branch: general information and its repeat/“yes” loop.
  const enInit = await json(`${actor}/sessions/${english}/initialize`, postBody({ language: "en-US" }));
  assert.equal(enInit.language, "en-US");
  const enRoute = await json(`${actor}/sessions/${english}/route`, postBody({ route: "information" }));
  assert.equal(enRoute.route, "information");
  // Exercise the Actor's confirmed-callback state transition separately from
  // the Edge Function's KV-backed callback queue.
  await json(`${actor}/sessions/${english}/callback`, postBody({
    name: "Actor Test Caller", number: "+46700000000", confirmed: true,
  }));
  const actorCallback = await json(`${actor}/sessions/${english}/queue-callback`, postBody({
    request_id: `actor-callback-${suffix}`,
  }));
  assert.equal(actorCallback.status, "queued");
  for (const topic of ["declaration", "deadlines"]) {
    const result = await json(`${edge}/api/information`, postBody({ session_id: english, topic, language: "en-US" }));
    assert.equal(result.result.language, "en-US");
    assert.match(result.result.answer, /General information/i);
  }

  // Swedish branch: general information.
  const svInit = await json(`${actor}/sessions/${swedish}/initialize`, postBody({ language: "sv-SE" }));
  assert.equal(svInit.language, "sv-SE");
  const svRoute = await json(`${actor}/sessions/${swedish}/route`, postBody({ route: "information" }));
  assert.equal(svRoute.route, "information");
  const svInfo = await json(`${edge}/api/information`, postBody({ session_id: swedish, topic: "deklaration", language: "sv-SE" }));
  assert.equal(svInfo.result.language, "sv-SE");
  assert.match(svInfo.result.answer, /Allmän information/i);

  // Validation: an unconfirmed callback cannot be queued.
  await json(`${actor}/sessions/${invalid}/initialize`, postBody({ language: "en-US" }));
  await json(`${actor}/sessions/${invalid}/callback`, postBody({ name: "Not Confirmed", number: "+46700000000", confirmed: false }));
  await expectStatus(`${actor}/sessions/${invalid}/queue-callback`, 400, postBody({ request_id: `invalid-${suffix}` }));

  // Callback branches in both languages; this also exercises KV queue writes.
  const callback = await json(`${edge}/api/callback`, postBody({
    session_id: english, callback_name: "Demo Caller", callback_number: "+46700000000", language: "en-US",
  }));
  assert.equal(callback.result.queue, "callback_requests");
  assert.equal(callback.result.status, "queued");
  const svCallback = await json(`${edge}/api/callback`, postBody({
    session_id: swedish, callback_name: "Demo Caller", callback_number: "+46700000000", language: "sv-SE",
  }));
  assert.equal(svCallback.result.queue, "callback_requests");
  assert.equal(svCallback.result.language, "sv-SE");

  // Human-assistance branch: queue live assistance without attempting a real call transfer.
  const transfer = await json(`${edge}/api/transfer`, postBody({ session_id: english, language: "en-US", call_control_id: "" }));
  assert.equal(transfer.result.queue, "live_tax_assistance");
  assert.equal(transfer.result.status, "queued");
  const live = await json(`${actor}/sessions/${swedish}/queue-live`, postBody({ ticket_id: `ticket-${suffix}` }));
  assert.equal(live.live_queue_status, "queued");

  // Dynamic webhook variables and duplicate-event protection.
  const webhookEvent = { id: `webhook-${suffix}`, data: { payload: { call_control_id: english, language: "English" } } };
  const firstWebhook = await json(`${edge}/api/workflow`, postBody(webhookEvent));
  assert.equal(firstWebhook.dynamic_variables.session_id, english);
  assert.equal(firstWebhook.dynamic_variables.language, "en-US");
  const duplicateWebhook = await json(`${edge}/api/workflow`, postBody(webhookEvent));
  assert.equal(duplicateWebhook.duplicate, true);

  // MCP discovery and a representative tax-information tool call.
  const mcpHeaders = auth ? { authorization: `Bearer ${auth}` } : {};
  const tools = await json(`${edge}/mcp`, { ...postBody({ jsonrpc: "2.0", id: 1, method: "tools/list" }), headers: mcpHeaders });
  assert.equal(tools.result.tools.length, 4);
  const mcpInfo = await json(`${edge}/mcp`, {
    ...postBody({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {
      name: "lookup_tax_information", arguments: { topic: "documents", language: "sv-SE" },
    } }), headers: mcpHeaders,
  });
  assert.match(mcpInfo.result.content[0].text, /Allmän information/i);

  // Final Actor state and the “no / hang up” completion branch.
  const enState = await json(`${actor}/sessions/${english}/state`);
  assert.equal(enState.session_id, english);
  assert.equal(enState.language, "en-US");
  assert.equal(enState.callback_confirmed, true);
  assert.equal(enState.status, "queued");
  const svState = await json(`${actor}/sessions/${swedish}/state`);
  assert.equal(svState.session_id, swedish);
  assert.equal(svState.language, "sv-SE");
  assert.equal(svState.callback_confirmed, true);
  assert.equal(svState.live_queue_status, "queued");
  const completed = await json(`${actor}/sessions/${english}/complete`, postBody({ event_id: `complete-${suffix}` }));
  assert.equal(completed.status, "completed");
});
