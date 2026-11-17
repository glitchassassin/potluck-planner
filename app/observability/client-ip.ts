import { isIP, SocketAddress } from "node:net";

export const clientIps = new WeakMap<Request, string>();

export function normalizeIp(value: string): string {
  switch (isIP(value)) {
    case 4:
      return value;
    case 6:
      return new SocketAddress({ address: value, family: "ipv6" }).address.replace(/^::ffff:/, "");
    default:
      return "";
  }
}

export function readTrustedProxyIps(value = process.env.TRUSTED_PROXY_IPS): ReadonlySet<string> {
  const ips = new Set<string>();
  for (const entry of (value ?? "").split(",")) {
    if (entry.trim() === "") continue;
    const ip = normalizeIp(entry.trim());
    if (!ip) throw new Error("Invalid IP address in TRUSTED_PROXY_IPS");
    ips.add(ip);
  }
  return ips;
}
