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
