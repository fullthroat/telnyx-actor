import { StatefulActor } from "@telnyx/edge-runtime";

export type Route = "information" | "human" | "callback" | "unknown";
export type CallStatus = "active" | "queued" | "completed" | "expired";
export interface CallState {
  session_id: string; language: "en-US" | "sv-SE" | "unknown"; route: Route;
  status: CallStatus; callback_name?: string; callback_number?: string;
  callback_confirmed: boolean; callback_request_id?: string; live_ticket_id?: string;
  live_queue_status?: "none" | "queued" | "claimed" | "completed";
  last_event_id?: string; created_at: string; updated_at: string;
}

const now = () => new Date().toISOString();

// Logs are JSON so the demo can filter actor lifecycle, state, and KV events.
const audit = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, ...fields, timestamp: now() }));

export class CallSession extends StatefulActor {
  // Actor storage is the authoritative state machine for one call/session.
  private async read(): Promise<CallState> {
    const existing = await this.ctx.storage.get<CallState>("state");
    if (existing) return existing;
    const created: CallState = {session_id:"unknown", language:"unknown", route:"unknown", status:"active", callback_confirmed:false, created_at:now(), updated_at:now()};
    await this.ctx.storage.put("state", created); audit("actor_state_created", { session_id: created.session_id }); return created;
  }
  private async write(state: CallState): Promise<CallState> { state.updated_at=now(); await this.ctx.storage.put("state", state); audit("actor_state_written", { session_id: state.session_id, route: state.route, status: state.status }); return state; }
  async getState(): Promise<CallState> { return this.read(); }
  async initialize(sessionId: string, language: CallState["language"], eventId?: string): Promise<CallState> { audit("workflow_session_initialized", { session_id: sessionId, language }); const s=await this.read(); s.session_id=sessionId; s.language=language; if(eventId)s.last_event_id=eventId; return this.write(s); }
  async selectRoute(route: Exclude<Route,"unknown">, eventId?: string): Promise<CallState> { audit("workflow_route_selected", { route }); const s=await this.read(); s.route=route; if(eventId)s.last_event_id=eventId; return this.write(s); }
  async saveCallback(name: string, number: string, confirmed: boolean, eventId?: string): Promise<CallState> { audit("workflow_callback_received", { name_present: Boolean(name.trim()), number_last4: number.trim().slice(-4), confirmed }); const s=await this.read(); s.callback_name=name.trim(); s.callback_number=number.trim(); s.callback_confirmed=confirmed; if(eventId)s.last_event_id=eventId; return this.write(s); }
  async queueCallback(requestId: string, eventId?: string): Promise<CallState> { const s=await this.read(); if(!s.callback_name||!s.callback_number||!s.callback_confirmed)throw new Error("callback details must be confirmed before queueing"); s.callback_request_id=requestId; s.status="queued"; if(eventId)s.last_event_id=eventId; audit("workflow_callback_marked_queued", { session_id:s.session_id, request_id:requestId }); return this.write(s); }
  async queueLiveAssistance(ticketId: string, eventId?: string): Promise<CallState> { const s=await this.read(); s.live_ticket_id=ticketId; s.live_queue_status="queued"; s.status="queued"; if(eventId)s.last_event_id=eventId; audit("workflow_human_transfer_marked_queued", { session_id:s.session_id, ticket_id:ticketId }); return this.write(s); }
  async complete(eventId?: string): Promise<CallState> { const s=await this.read(); s.status="completed"; if(eventId)s.last_event_id=eventId; audit("workflow_session_completed", { session_id:s.session_id }); return this.write(s); }

  async update(patch: Partial<CallState>): Promise<CallState> {
    audit("workflow_state_patch_received", { fields: Object.keys(patch) });
    const s = await this.read();
    Object.assign(s, patch);
    return this.write(s);
  }
}
