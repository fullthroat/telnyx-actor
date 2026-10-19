import { StatefulActor } from "@telnyx/edge-runtime";
import { env } from "@telnyx/edge-runtime";

interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const kv = (env as unknown as { STATE_KV: KvNamespaceLike }).STATE_KV;

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

export class CallSession extends StatefulActor {
  private async read(): Promise<CallState> {
    const existing = await this.ctx.storage.get<CallState>("state");
    if (existing) return existing;
    const created: CallState = {session_id:"unknown", language:"unknown", route:"unknown", status:"active", callback_confirmed:false, created_at:now(), updated_at:now()};
    await this.ctx.storage.put("state", created); return created;
  }
  private async write(state: CallState): Promise<CallState> { state.updated_at=now(); await this.ctx.storage.put("state", state); return state; }
  async getState(): Promise<CallState> { return this.read(); }
  async initialize(sessionId: string, language: CallState["language"], eventId?: string): Promise<CallState> { const s=await this.read(); s.session_id=sessionId; s.language=language; if(eventId)s.last_event_id=eventId; return this.write(s); }
  async selectRoute(route: Exclude<Route,"unknown">, eventId?: string): Promise<CallState> { const s=await this.read(); s.route=route; if(eventId)s.last_event_id=eventId; return this.write(s); }
  async saveCallback(name: string, number: string, confirmed: boolean, eventId?: string): Promise<CallState> { const s=await this.read(); s.callback_name=name.trim(); s.callback_number=number.trim(); s.callback_confirmed=confirmed; if(eventId)s.last_event_id=eventId; return this.write(s); }
  async queueCallback(requestId: string, eventId?: string): Promise<CallState> { const s=await this.read(); if(!s.callback_name||!s.callback_number||!s.callback_confirmed)throw new Error("callback details must be confirmed before queueing"); s.callback_request_id=requestId; s.status="queued"; await kv.put(`callback:${requestId}`,JSON.stringify({request_id:requestId,session_id:s.session_id,callback_name:s.callback_name,callback_number:s.callback_number,language:s.language,status:"queued",created_at:now()}),{expirationTtl:604800}); if(eventId)s.last_event_id=eventId; return this.write(s); }
  async queueLiveAssistance(ticketId: string, eventId?: string): Promise<CallState> { const s=await this.read(); s.live_ticket_id=ticketId; s.live_queue_status="queued"; s.status="queued"; await kv.put(`live:${ticketId}`,JSON.stringify({ticket_id:ticketId,session_id:s.session_id,language:s.language,status:"queued",created_at:now()}),{expirationTtl:86400}); if(eventId)s.last_event_id=eventId; return this.write(s); }
  async complete(eventId?: string): Promise<CallState> { const s=await this.read(); s.status="completed"; if(eventId)s.last_event_id=eventId; return this.write(s); }

  async update(patch: Partial<CallState>): Promise<CallState> {
    const s = await this.read();
    Object.assign(s, patch);
    return this.write(s);
  }
}
