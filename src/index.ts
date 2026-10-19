import type { ActorNamespace, ActorStub, IdFromNameOptions } from "@telnyx/edge-runtime";
import { CallSession, type CallState } from "./session";
export { CallSession } from "./session";
type SessionStub=ActorStub&Pick<CallSession,"getState"|"initialize"|"selectRoute"|"saveCallback"|"queueCallback"|"queueLiveAssistance"|"complete"|"update">;
interface SessionNamespace extends ActorNamespace { idFromName(name:string,options?:IdFromNameOptions):SessionStub; }
interface Env { CALL_SESSION:SessionNamespace; }
const json=(value:unknown,status=200)=>Response.json(value,{status});
export default { async fetch(request:Request,env:Env):Promise<Response> {
  const url=new URL(request.url); if(url.pathname==="/health/liveness"||url.pathname==="/health/readiness")return new Response("ok");
  const m=url.pathname.match(/^\/sessions\/([^/]+)(?:\/(state|initialize|route|callback|queue-callback|queue-live|complete|update))?$/); if(!m)return json({error:"not_found"},404);
  const id=decodeURIComponent(m[1]!); const action=m[2]??"state"; const stub=env.CALL_SESSION.idFromName(id);
  if(action==="state"&&request.method==="GET")return json(await stub.getState()); if(request.method!=="POST")return json({error:"method_not_allowed"},405);
  const body=await request.json().catch(()=>({})) as Record<string,unknown>; const eventId=typeof body.event_id==="string"?body.event_id:undefined;
  try { let state:CallState; if(action==="initialize")state=await stub.initialize(id,body.language==="sv-SE"?"sv-SE":"en-US",eventId); else if(action==="route")state=await stub.selectRoute(body.route as "information"|"human"|"callback",eventId); else if(action==="callback")state=await stub.saveCallback(String(body.name??""),String(body.number??""),body.confirmed===true,eventId); else if(action==="queue-callback")state=await stub.queueCallback(String(body.request_id??""),eventId); else if(action==="queue-live")state=await stub.queueLiveAssistance(String(body.ticket_id??""),eventId); else if(action==="complete")state=await stub.complete(eventId); else if(action==="update")state=await stub.update(body.patch as Partial<CallState>); else return json({error:"unknown_action"},404); return json(state); }
  catch(error){ return json({error:error instanceof Error?error.message:"actor_error"},400); }
} };
