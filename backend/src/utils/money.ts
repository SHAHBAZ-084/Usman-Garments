/** Safe money helpers — always round to 2 decimal places (paisa precision). */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sumMoney(values: number[]): number {
  return roundMoney(values.reduce((s, v) => s + v, 0));
}

export function toNumber(value: number | string | { toString(): string }): number {
  return roundMoney(Number(value));
}

export function multiplyMoney(unit: number, qty: number): number {
  return roundMoney(unit * qty);
}
