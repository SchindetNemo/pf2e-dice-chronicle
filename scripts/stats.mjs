/**
 * Pure statistics, awards and moment detection. No Foundry document access
 * except game.i18n for text.
 */
export const HOT_MIN = 15;   // d20 >= this counts toward a hot streak
export const COLD_MAX = 5;   // d20 <= this counts toward a cold streak
export const MIN_HOT = 3;
export const MIN_COLD = 3;
export const MIN_CRIT_STREAK = 2;
export const MIN_FUMBLE_STREAK = 2;
export const MIN_SAME = 3;   // same number (other than 1/20) this many times in a row

const L = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const round = (n, p = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** p) / 10 ** p : 0);

/** Find maximal runs in seq where pred(value) is true. */
function runs(seq, pred, min) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= seq.length; i++) {
    const ok = i < seq.length && pred(seq[i].v);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= min) out.push(seq.slice(start, i));
      start = -1;
    }
  }
  return out;
}

/** Runs of the same repeated value (natural 1s and 20s are covered by fumble/crit streaks). */
export function sameRuns(seq, min = MIN_SAME) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= seq.length; i++) {
    if (i < seq.length && seq[i].v === seq[start].v) continue;
    const v = seq[start].v;
    if (i - start >= min && v !== 1 && v !== 20) out.push(seq.slice(start, i));
    start = i;
  }
  return out;
}

const D20_MEAN = 10.5;
const D20_SD = Math.sqrt((20 * 20 - 1) / 12); // ≈ 5.766

/** Standard normal CDF (Abramowitz–Stegun). */
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** How many standard errors the average of n natural d20s sits from a fair d20. */
export function luckZ(mean, n) {
  return n ? (mean - D20_MEAN) / (D20_SD / Math.sqrt(n)) : 0;
}

/**
 * Luck score 0-100: the chance that a fair d20 would have averaged *lower* than this player
 * over the same number of rolls. 50 = typical, 95+ = rolled better than almost every fair
 * run of that length, 5- = worse than almost every one.
 */
export function luckScore(mean, n) {
  return Math.round(phi(luckZ(mean, n)) * 100);
}

/**
 * @param {Array<Array<object>>} rollSets  one array of roll entries per session
 * @param {object} [opts]
 * @param {number} [opts.minD20=5]  d20s needed to qualify for luck awards
 */
export function computeStats(rollSets, { minD20 = 5 } = {}) {
  const players = new Map();
  const faceCounts = new Map(); // face -> {total, byUser: Map}
  const moments = [];
  const bestRuns = new Map();   // userId -> {hot, cold}
  let totalRolls = 0, totalDice = 0;

  const get = (r) => {
    if (!players.has(r.u)) {
      players.set(r.u, {
        id: r.u, name: r.un, characters: new Set(), rolls: 0, dice: 0, d20s: 0,
        hist: Array(20).fill(0), d20Sum: 0, checkSum: 0, checkRolls: 0, low: 0, high: 0, crits: 0, fumbles: 0, totalSum: 0,
        best: null, worst: null, successes: 0, critSuccesses: 0, failures: 0, critFailures: 0
      });
    }
    return players.get(r.u);
  };

  for (const rolls of rollSets) {
    const seqs = new Map(); // userId -> [{v, ts}]
    for (const r of rolls) {
      const p = get(r);
      p.name = r.un || p.name;
      if (r.an) p.characters.add(r.an);
      p.rolls++; totalRolls++;
      p.dice += r.d ?? 0; totalDice += r.d ?? 0;
      p.totalSum += r.tot ?? 0;
      if (r.n?.length) { p.checkSum += r.tot ?? 0; p.checkRolls++; } // d20 rolls only
      if (r.ot === "criticalSuccess") p.critSuccesses++;
      else if (r.ot === "success") p.successes++;
      else if (r.ot === "failure") p.failures++;
      else if (r.ot === "criticalFailure") p.critFailures++;
      for (const v of r.n ?? []) {
        p.d20s++; p.d20Sum += v;
        if (v >= 1 && v <= 20) p.hist[v - 1]++;
        if (v < 5) p.low++;
        if (v > 15) p.high++;
        if (v === 20) p.crits++;
        if (v === 1) p.fumbles++;
        const f = faceCounts.get(v) ?? { total: 0, byUser: new Map() };
        f.total++; f.byUser.set(r.u, (f.byUser.get(r.u) ?? 0) + 1);
        faceCounts.set(v, f);
        if (!seqs.has(r.u)) seqs.set(r.u, []);
        seqs.get(r.u).push({ v, ts: r.ts });
      }
    }

    for (const [uid, seq] of seqs) {
      const p = players.get(uid);
      const mk = (type, run) => ({
        type, userId: uid, name: p.name, len: run.length, values: run.map(x => x.v),
        ts: run[run.length - 1].ts
      });
      for (const run of runs(seq, v => v === 20, MIN_CRIT_STREAK)) moments.push(mk("crit", run));
      for (const run of runs(seq, v => v === 1, MIN_FUMBLE_STREAK)) moments.push(mk("fumble", run));
      for (const run of sameRuns(seq)) moments.push(mk("same", run));
      const hot = runs(seq, v => v >= HOT_MIN, MIN_HOT).filter(run => !run.every(x => x.v === 20));
      for (const run of hot) moments.push(mk("hot", run));
      const cold = runs(seq, v => v <= COLD_MAX, MIN_COLD).filter(run => !run.every(x => x.v === 1));
      for (const run of cold) moments.push(mk("cold", run));
      const best = bestRuns.get(uid) ?? { hot: 0, cold: 0 };
      for (const run of runs(seq, v => v >= HOT_MIN, 1)) best.hot = Math.max(best.hot, run.length);
      for (const run of runs(seq, v => v <= COLD_MAX, 1)) best.cold = Math.max(best.cold, run.length);
      bestRuns.set(uid, best);
    }
  }

  const list = [...players.values()].map(p => {
    const mean = p.d20s ? p.d20Sum / p.d20s : 0;
    const br = bestRuns.get(p.id) ?? { hot: 0, cold: 0 };
    return {
      ...p,
      characters: [...p.characters].join(", "),
      avgD20: p.d20s ? round(mean) : "–",
      avgTotal: p.checkRolls ? round(p.checkSum / p.checkRolls) : "–",
      critRate: p.d20s ? round((p.crits / p.d20s) * 100) : 0,
      fumbleRate: p.d20s ? round((p.fumbles / p.d20s) * 100) : 0,
      luck: p.d20s ? luckScore(mean, p.d20s) : null,
      luckLabel: p.d20s ? String(luckScore(mean, p.d20s)) : "–",
      hotStreak: br.hot, coldStreak: br.cold,
      _mean: mean, _z: luckZ(mean, p.d20s)
    };
  }).sort((a, b) => b.rolls - a.rolls);

  const awards = computeAwards(list, faceCounts, minD20);
  const sorted = sortMoments(moments);
  return {
    players: list, awards, moments: sorted,
    totals: { rolls: totalRolls, dice: totalDice, avgDie: list.some(p => p.d20s) ? round(list.reduce((s, p) => s + p.d20Sum, 0) / list.reduce((s, p) => s + p.d20s, 0), 2) : "–", players: list.length,
      crits: list.reduce((s, p) => s + p.crits, 0), fumbles: list.reduce((s, p) => s + p.fumbles, 0) }
  };
}

const MOMENT_PRIORITY = { crit: 0, fumble: 1, same: 2, hot: 3, cold: 4 };
function sortMoments(moments) {
  return moments.sort((a, b) =>
    b.len - a.len || MOMENT_PRIORITY[a.type] - MOMENT_PRIORITY[b.type] || b.ts - a.ts);
}

export function describeMoment(m) {
  const vals = m.values.join(" → ");
  const meta = {
    crit: { icon: "fa-bolt", key: "CRIT" },
    fumble: { icon: "fa-skull", key: "FUMBLE" },
    hot: { icon: "fa-fire", key: "HOT" },
    cold: { icon: "fa-snowflake", key: "COLD" },
    same: { icon: "fa-clone", key: "SAME" }
  }[m.type];
  return {
    ...m, icon: meta.icon, cls: m.type, vals,
    title: L(`CHRONICLE.Moment.${meta.key}`),
    text: L(m.type === "same" ? "CHRONICLE.Moment.TextSame" : "CHRONICLE.Moment.Text",
      { name: m.name, len: m.len, n: m.values[0] }),
    when: m.ts ? new Date(m.ts).toLocaleString() : ""
  };
}

function pickMax(players, fn, { min = 1, reverse = false } = {}) {
  const pool = players.filter(p => Number.isFinite(fn(p)));
  if (!pool.length) return null;
  const best = reverse ? Math.min(...pool.map(fn)) : Math.max(...pool.map(fn));
  if (!reverse && best < min) return null;
  return { value: best, winners: pool.filter(p => fn(p) === best) };
}

function computeAwards(players, faceCounts, minD20) {
  const awards = [];
  const names = (w) => w.map(p => p.name).join(" & ");
  const add = (id, icon, res, valueText) => {
    if (!res) return;
    awards.push({
      id, icon, title: L(`CHRONICLE.Award.${id}.Title`),
      flavor: L(`CHRONICLE.Award.${id}.Flavor`),
      winner: names(res.winners), value: valueText, raw: res.value
    });
  };

  const eligible = players.filter(p => p.d20s >= minD20);
  const lucky = pickMax(eligible, p => p._z);
  const cursed = pickMax(eligible, p => p._z, { reverse: true });
  if (lucky) add("Lucky", "fa-clover", lucky,
    L("CHRONICLE.Award.LuckyValue", { luck: lucky.winners[0].luck, avg: lucky.winners[0].avgD20 }));
  if (cursed && lucky && cursed.value < lucky.value) add("Cursed", "fa-ghost", cursed,
    L("CHRONICLE.Award.CursedValue", { luck: cursed.winners[0].luck, avg: cursed.winners[0].avgD20 }));

  const crit = pickMax(players, p => p.crits);
  add("Crit", "fa-bolt", crit, crit && L("CHRONICLE.Award.CritValue", { n: crit.value }));
  const fum = pickMax(players, p => p.fumbles);
  add("Fumble", "fa-skull-crossbones", fum, fum && L("CHRONICLE.Award.FumbleValue", { n: fum.value }));
  const hog = pickMax(players.filter(p => !game.users.get(p.id)?.isGM), p => p.dice); // GM never wins the Dice Hog
  add("Hog", "fa-dice", hog, hog && L("CHRONICLE.Award.HogValue", { n: hog.value }));

  const low = pickMax(players, p => p.low);
  add("Low", "fa-arrow-trend-down", low, low && L("CHRONICLE.Award.LowValue", { n: low.value }));
  const high = pickMax(players, p => p.high);
  add("High", "fa-arrow-trend-up", high, high && L("CHRONICLE.Award.HighValue", { n: high.value }));

  // Lucky number: most frequently rolled natural d20 face
  let face = null;
  for (const [v, f] of faceCounts) {
    if (f.total >= 2 && (!face || f.total > face.total || (f.total === face.total && v > face.v))) face = { v, ...f };
  }
  if (face) {
    const top = Math.max(...face.byUser.values());
    const who = players.filter(p => face.byUser.get(p.id) === top);
    awards.push({
      id: "Number", icon: "fa-hashtag", title: L("CHRONICLE.Award.Number.Title"),
      flavor: L("CHRONICLE.Award.Number.Flavor"), winner: `#${face.v}`,
      value: L("CHRONICLE.Award.NumberValue", { n: face.total, who: names(who), k: top }), big: true
    });
  }

  const hot = pickMax(players, p => p.hotStreak, { min: MIN_HOT });
  add("Hot", "fa-fire", hot, hot && L("CHRONICLE.Award.HotValue", { n: hot.value, min: HOT_MIN }));
  const cold = pickMax(players, p => p.coldStreak, { min: MIN_COLD });
  add("Cold", "fa-snowflake", cold, cold && L("CHRONICLE.Award.ColdValue", { n: cold.value, max: COLD_MAX }));
  return awards;
}
