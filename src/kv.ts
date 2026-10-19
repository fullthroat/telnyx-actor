/** KV boundary for cache, idempotency and feature flags, not active call state. */
export interface KvValue { [key: string]: unknown }
export interface KvStore { get<T extends KvValue>(key:string):Promise<T|null>; put<T extends KvValue>(key:string,value:T,ttlSeconds:number):Promise<void>; delete(key:string):Promise<void>; }

export class HttpKvStore implements KvStore {
  constructor(private readonly baseUrl:string, private readonly token?:string) {}
  private url(key:string):string { return `${this.baseUrl.replace(/\/$/,"")}/keys/${encodeURIComponent(key)}`; }
  private headers():HeadersInit { return {"content-type":"application/json", ...(this.token?{authorization:`Bearer ${this.token}`}:{})}; }
  async get<T extends KvValue>(key:string):Promise<T|null> { const r=await fetch(this.url(key),{headers:this.headers()}); if(r.status===404)return null; if(!r.ok)throw new Error(`KV GET failed: ${r.status}`); const b=await r.json() as {value?:T}|T; return ("value" in b?b.value:b) as T; }
  async put<T extends KvValue>(key:string,value:T,ttlSeconds:number):Promise<void> { const r=await fetch(this.url(key),{method:"PUT",headers:this.headers(),body:JSON.stringify({value,ttl_seconds:ttlSeconds})}); if(!r.ok)throw new Error(`KV PUT failed: ${r.status}`); }
  async delete(key:string):Promise<void> { const r=await fetch(this.url(key),{method:"DELETE",headers:this.headers()}); if(!r.ok&&r.status!==404)throw new Error(`KV DELETE failed: ${r.status}`); }
}
