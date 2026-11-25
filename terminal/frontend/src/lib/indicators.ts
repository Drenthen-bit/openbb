// Technical indicators over plain number arrays. Undefined where not yet defined.

export function sma(values: number[], n: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    out.push(i >= n - 1 ? sum / n : undefined);
  }
  return out;
}

export function ema(values: number[], n: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  const k = 2 / (n + 1);
  let prev: number | undefined;
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) {
      out.push(undefined);
      continue;
    }
    if (prev === undefined) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += values[j];
      prev = s / n;
    } else prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], n = 14): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length <= n) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => (f[i] !== undefined && s[i] !== undefined ? f[i]! - s[i]! : undefined));
  const firstIdx = line.findIndex((v) => v !== undefined);
  const sig: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (firstIdx >= 0) {
    const e = ema(line.slice(firstIdx) as number[], signal);
    e.forEach((v, i) => (sig[firstIdx + i] = v));
  }
  const hist = line.map((v, i) => (v !== undefined && sig[i] !== undefined ? v - sig[i]! : undefined));
  return { line, signal: sig, hist };
}

export function bollinger(values: number[], n = 20, k = 2) {
  const mid = sma(values, n);
  const upper: (number | undefined)[] = [];
  const lower: (number | undefined)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (mid[i] === undefined) {
      upper.push(undefined);
      lower.push(undefined);
      continue;
    }
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (values[j] - mid[i]!) ** 2;
    const sd = Math.sqrt(v / n);
    upper.push(mid[i]! + k * sd);
    lower.push(mid[i]! - k * sd);
  }
  return { mid, upper, lower };
}

export function vwap(highs: number[], lows: number[], closes: number[], volumes: number[]) {
  let pv = 0;
  let vv = 0;
  return closes.map((c, i) => {
    const tp = (highs[i] + lows[i] + c) / 3;
    pv += tp * volumes[i];
    vv += volumes[i];
    return vv ? pv / vv : undefined;
  });
}
