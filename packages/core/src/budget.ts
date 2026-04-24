/**
 * Per-process daily spend tracker. Resets at UTC midnight.
 * Note: this is in-memory, not cross-instance. For accurate multi-instance
 * caps you need the collector to enforce them.
 */

let day = currentUtcDay();
let spent = 0;

function currentUtcDay(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export function recordSpend(usd: number): void {
  const now = currentUtcDay();
  if (now !== day) {
    day = now;
    spent = 0;
  }
  spent += usd;
}

export function spendToday(): number {
  if (currentUtcDay() !== day) return 0;
  return spent;
}

export class BudgetExceededError extends Error {
  constructor(public readonly capUsd: number, public readonly spentUsd: number) {
    super(`[llmmeter] daily spend cap exceeded: $${spentUsd.toFixed(4)} > $${capUsd.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}
