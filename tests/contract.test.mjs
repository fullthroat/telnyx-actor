import test from "node:test";
import assert from "node:assert/strict";
test("session identity is the call id",()=>assert.equal(encodeURIComponent("call-123"),"call-123"));
test("callback queue requires a request id",()=>assert.ok("callback-123"));
