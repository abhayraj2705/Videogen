import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isBlockedIp } from "./ssrf.js";

describe("isBlockedIp", () => {
  it("blocks private IPv4 ranges", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("10.255.255.255")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("192.168.255.255")).toBe(true);
  });

  it("blocks loopback and link-local (including cloud metadata)", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.0.0.53")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true); // AWS/GCP/Azure metadata endpoint
    expect(isBlockedIp("169.254.1.1")).toBe(true);
  });

  it("blocks 0.0.0.0, CGNAT, multicast and reserved ranges", () => {
    expect(isBlockedIp("0.0.0.0")).toBe(true);
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("240.0.0.1")).toBe(true);
  });

  it("blocks IPv6 loopback, link-local and unique-local", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456:789a::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 addresses that wrap a blocked v4 address", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
  });

  it("allows ordinary public IPv4 and IPv6 addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false); // example.com
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false); // Cloudflare public IPv6
  });

  it("refuses to guess on unparseable input", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });
});

describe("assertResolvesToPublicIp", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("rejects a hostname whose DNS record resolves to a private IP", async () => {
    vi.doMock("node:dns/promises", () => ({
      default: { lookup: vi.fn().mockResolvedValue([{ address: "127.0.0.1", family: 4 }]) },
      lookup: vi.fn().mockResolvedValue([{ address: "127.0.0.1", family: 4 }]),
    }));
    const { assertResolvesToPublicIp, SsrfBlockedError } = await import("./ssrf.js");
    await expect(assertResolvesToPublicIp("internal.example")).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects when ANY resolved address is private, even if others are public", async () => {
    vi.doMock("node:dns/promises", () => ({
      default: {
        lookup: vi.fn().mockResolvedValue([
          { address: "8.8.8.8", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ]),
      },
      lookup: vi.fn().mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]),
    }));
    const { assertResolvesToPublicIp, SsrfBlockedError } = await import("./ssrf.js");
    await expect(assertResolvesToPublicIp("mixed.example")).rejects.toThrow(SsrfBlockedError);
  });

  it("allows a hostname that resolves only to public IPs", async () => {
    vi.doMock("node:dns/promises", () => ({
      default: { lookup: vi.fn().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]) },
      lookup: vi.fn().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]),
    }));
    const { assertResolvesToPublicIp } = await import("./ssrf.js");
    await expect(assertResolvesToPublicIp("public.example")).resolves.toEqual(["8.8.8.8"]);
  });

  it("rejects a literal private IP passed directly as the hostname", async () => {
    const { assertResolvesToPublicIp, SsrfBlockedError } = await import("./ssrf.js");
    await expect(assertResolvesToPublicIp("192.168.1.1")).rejects.toThrow(SsrfBlockedError);
  });
});

describe("isBlockedIp — IPv6 edge forms", () => {
  it("blocks IPv4-mapped addresses in hex form and bracketed literals", () => {
    expect(isBlockedIp("::ffff:7f00:1")).toBe(true); // ::ffff:127.0.0.1
    expect(isBlockedIp("::ffff:a9fe:a9fe")).toBe(true); // ::ffff:169.254.169.254
    expect(isBlockedIp("[::1]")).toBe(true);
    expect(isBlockedIp("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
  });

  it("blocks NAT64 / 6to4 / IPv4-compatible wrappers around private v4", () => {
    expect(isBlockedIp("64:ff9b::10.0.0.1")).toBe(true);
    expect(isBlockedIp("2002:c0a8:0101::1")).toBe(true); // 6to4 of 192.168.1.1
    expect(isBlockedIp("::127.0.0.1")).toBe(true);
  });

  it("blocks multicast, site-local and documentation v6 ranges", () => {
    expect(isBlockedIp("ff02::1")).toBe(true);
    expect(isBlockedIp("fec0::1")).toBe(true);
    expect(isBlockedIp("2001:db8::1")).toBe(true);
    expect(isBlockedIp("fe80::1%eth0")).toBe(true);
  });

  it("allows public mapped / NAT64 / 6to4 addresses", () => {
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedIp("64:ff9b::808:808")).toBe(false);
    expect(isBlockedIp("2002:0808:0808::1")).toBe(false);
  });
});

describe("createPinnedLookup", () => {
  it("answers every lookup with the pinned address regardless of the hostname asked", async () => {
    const { createPinnedLookup } = await import("./ssrf.js");
    const lookup = createPinnedLookup([{ address: "93.184.216.34", family: 4 }]);
    const single = await new Promise<[string, number]>((resolve, reject) =>
      lookup("evil-rebind.example", {}, (err, address, family) => (err ? reject(err) : resolve([address as string, family as number]))),
    );
    expect(single).toEqual(["93.184.216.34", 4]);
    const all = await new Promise<unknown>((resolve, reject) =>
      lookup("evil-rebind.example", { all: true }, (err, address) => (err ? reject(err) : resolve(address))),
    );
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuses to pin a blocked address", async () => {
    const { createPinnedLookup, SsrfBlockedError } = await import("./ssrf.js");
    expect(() => createPinnedLookup([{ address: "10.0.0.1", family: 4 }])).toThrow(SsrfBlockedError);
  });
});

describe("ssrfSafeFetch", () => {
  const RECORDS: Record<string, { address: string; family: 4 | 6 }[]> = {
    "public.example": [{ address: "93.184.216.34", family: 4 }],
    "other.example": [{ address: "1.1.1.1", family: 4 }],
    "rebind.example": [{ address: "127.0.0.1", family: 4 }],
    "v6private.example": [{ address: "fd00::1", family: 6 }],
    "mapped.example": [{ address: "::ffff:192.168.0.10", family: 6 }],
  };
  const resolver = async (host: string) => {
    const r = RECORDS[host];
    if (!r) throw new Error("ENOTFOUND");
    return r;
  };
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  it("follows a redirect to another public host, re-validating and pinning per hop", async () => {
    const { ssrfSafeFetch } = await import("./ssrf.js");
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: Record<string, unknown>) => {
      calls.push({ url, init });
      return url.includes("public.example") ? redirect("https://other.example/landing") : new Response("ok", { status: 200 });
    });
    const res = await ssrfSafeFetch("https://public.example/", { resolver, fetchImpl });
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(["https://public.example/", "https://other.example/landing"]);
    for (const c of calls) {
      expect(c.init.redirect).toBe("manual");
      expect(c.init.dispatcher).toBeDefined(); // pinned undici Agent
    }
  });

  it("blocks a redirect that points at a private IP literal", async () => {
    const { ssrfSafeFetch, SsrfBlockedError } = await import("./ssrf.js");
    const fetchImpl = vi.fn(async () => redirect("http://169.254.169.254/latest/meta-data/"));
    await expect(ssrfSafeFetch("https://public.example/", { resolver, fetchImpl })).rejects.toThrow(SsrfBlockedError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a hostname that resolves privately (DNS rebinding style)", async () => {
    const { ssrfSafeFetch, SsrfBlockedError } = await import("./ssrf.js");
    const fetchImpl = vi.fn(async () => redirect("https://rebind.example/admin"));
    await expect(ssrfSafeFetch("https://public.example/", { resolver, fetchImpl })).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks hosts that resolve to private IPv6 or IPv4-mapped IPv6 addresses", async () => {
    const { ssrfSafeFetch, SsrfBlockedError } = await import("./ssrf.js");
    const fetchImpl = vi.fn(async () => new Response("nope"));
    await expect(ssrfSafeFetch("https://v6private.example/", { resolver, fetchImpl })).rejects.toThrow(SsrfBlockedError);
    await expect(ssrfSafeFetch("https://mapped.example/", { resolver, fetchImpl })).rejects.toThrow(SsrfBlockedError);
    await expect(ssrfSafeFetch("http://[::ffff:127.0.0.1]/", { resolver, fetchImpl })).rejects.toThrow(SsrfBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-http(s) protocols, including via redirect", async () => {
    const { ssrfSafeFetch, SsrfBlockedError } = await import("./ssrf.js");
    for (const u of ["file:///etc/passwd", "ftp://public.example/", "gopher://public.example/", "data:text/html,hi"]) {
      await expect(ssrfSafeFetch(u, { resolver, fetchImpl: vi.fn() })).rejects.toThrow(SsrfBlockedError);
    }
    const fetchImpl = vi.fn(async () => redirect("file:///etc/passwd"));
    await expect(ssrfSafeFetch("https://public.example/", { resolver, fetchImpl })).rejects.toThrow(/Unsupported protocol/);
  });

  it("enforces the redirect limit", async () => {
    const { ssrfSafeFetch, SsrfBlockedError } = await import("./ssrf.js");
    let n = 0;
    const fetchImpl = vi.fn(async () => redirect(`https://public.example/hop-${++n}`));
    await expect(ssrfSafeFetch("https://public.example/", { resolver, fetchImpl, maxRedirects: 3 })).rejects.toThrow(SsrfBlockedError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("normalizes decimal/hex IPv4 hostnames and blocks internal names", async () => {
    const { ssrfSafeFetch, SsrfBlockedError } = await import("./ssrf.js");
    for (const u of ["http://2130706433/", "http://0x7f.1/", "http://localhost/", "http://metadata.google.internal/"]) {
      await expect(ssrfSafeFetch(u, { resolver, fetchImpl: vi.fn() })).rejects.toThrow(SsrfBlockedError);
    }
  });
});

describe("readBodyCapped", () => {
  it("truncates bodies over the cap", async () => {
    const { readBodyCapped } = await import("./ssrf.js");
    const out = await readBodyCapped(new Response("a".repeat(5000)), 1000);
    expect(out.text.length).toBe(1000);
    expect(out.truncated).toBe(true);
    const small = await readBodyCapped(new Response("hello"), 1000);
    expect(small).toEqual({ text: "hello", truncated: false });
  });
});
