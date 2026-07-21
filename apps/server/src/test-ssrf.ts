import assert from "node:assert";
import { jePrivatanIp } from "./modules/dashboard/routes.js";

// Self-check klasifikatora privatnih adresa (SSRF zastita, faza 6).
// Pokreni: pnpm --filter @albatron/server exec tsx src/test-ssrf.ts

// Blokirane (privatne / loopback / link-local / reserved / neispravne).
for (const ip of [
  "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
  "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
  "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
  "::ffff:127.0.0.1", "::ffff:10.0.0.1", "nije-ip",
]) {
  assert.strictEqual(jePrivatanIp(ip), true, `ocekivano privatno: ${ip}`);
}

// Dozvoljene (javne).
for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111"]) {
  assert.strictEqual(jePrivatanIp(ip), false, `ocekivano javno: ${ip}`);
}

console.log("test-ssrf: OK");
