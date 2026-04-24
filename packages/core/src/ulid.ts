/**
 * Minimal ULID generator (Crockford base32, monotonic-ish within process).
 * Avoids a dep just for IDs.
 */

import { randomFillSync } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RAND_LEN = 16;

let lastTime = -1;
let lastRand = new Uint8Array(RAND_LEN);

function encodeTime(time: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % 32;
    out = ENCODING[mod] + out;
    time = (time - mod) / 32;
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < RAND_LEN; i++) {
    out += ENCODING[(bytes[i] ?? 0) % 32];
  }
  return out;
}

function incrementBytes(bytes: Uint8Array): void {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if ((bytes[i] ?? 0) < 0xff) {
      bytes[i] = (bytes[i] ?? 0) + 1;
      return;
    }
    bytes[i] = 0;
  }
}

export function ulid(now: number = Date.now()): string {
  if (now === lastTime) {
    incrementBytes(lastRand);
  } else {
    lastTime = now;
    lastRand = new Uint8Array(RAND_LEN);
    randomFillSync(lastRand);
  }
  return encodeTime(now) + encodeRandom(lastRand);
}
