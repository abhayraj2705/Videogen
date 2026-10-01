import { describe, expect, it } from "vitest";
import { domainThrottleKey, ipRateLimitKey, jobCreateRateLimitKey, targetDomainOf, userRateLimitKey } from "./rate-limit.js";

describe("rate-limit key derivation", () => {
  it("namespaces each bucket so limiters sharing one store never collide", () => {
    const id = "6f1c0f8e-0000-4000-8000-000000000000";
    const keys = [ipRateLimitKey("1.2.3.4"), userRateLimitKey(id), jobCreateRateLimitKey(id), domainThrottleKey("https://example.com")];
    expect(keys).toEqual(["ip:1.2.3.4", `user:${id}`, `jobcreate:user:${id}`, "domain:example.com"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keys IPv6 addresses verbatim", () => {
    expect(ipRateLimitKey("::1")).toBe("ip:::1");
  });
});

describe("targetDomainOf", () => {
  it("normalises case, port, www and trailing dot", () => {
    expect(targetDomainOf("https://WWW.Example.com:8443/pricing?x=1")).toBe("example.com");
    expect(targetDomainOf("http://example.com./")).toBe("example.com");
    expect(targetDomainOf("https://app.example.com")).toBe("app.example.com");
  });

  it("treats http/https and paths of one site as one bucket", () => {
    expect(domainThrottleKey("http://example.com/a")).toBe(domainThrottleKey("https://www.example.com/b"));
  });

  it("returns undefined for unparseable input", () => {
    expect(targetDomainOf("not a url")).toBeUndefined();
    expect(domainThrottleKey("")).toBeUndefined();
  });
});
