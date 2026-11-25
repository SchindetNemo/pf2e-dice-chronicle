import { MOD } from "./store.mjs";
import { computeStats, HOT_MIN, COLD_MAX, MIN_HOT, MIN_COLD, MIN_CRIT_STREAK, MIN_FUMBLE_STREAK, MIN_SAME } from "./stats.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s));
const L = (k, d) => game.i18n.format(k, d);

/** Last announced winner per award, reset whenever the live session changes. */
let lastSession = null;
const lastWinners = new Map();
// Awards that would change every few rolls are left to the end-of-session summary.
const LIVE_AWARDS = new Set(["Lucky", "Cursed", "Crit", "Fumble", "Hot", "Cold"]);

function trailingRun(values, pred) {
  let n = 0;
  for (let i = values.length - 1; i >= 0 && pred(values[i]); i--) n++;
  return n;
}

function post(icon, cls, html) {
  return ChatMessage.create({
    content: `<div class="chronicle-chat ${cls}"><i class="fa-solid ${icon}"></i> ${html}</div>`
  });
}

/** Called by the active GM after a roll has been recorded in the live session. */
export async function announce(entry, session) {
  if (!game.settings.get(MOD, "announce")) return;
  if (lastSession !== session.id) { lastSession = session.id; lastWinners.clear(); }

  // Streaks: look at the trailing run of this player's d20 results.
  if (entry.n?.length) {
    const vals = session.rolls.filter(r => r.u === entry.u).flatMap(r => r.n ?? []);
    const name = esc(entry.un);
    const check = (pred, min, key, icon, cls, extra, skipIf) => {
      const len = trailingRun(vals, pred);
      if (len < min) return;
      const run = vals.slice(-len);
      if (skipIf?.(run)) return;
      return post(icon, cls, L(`CHRONICLE.Live.${key}`, { name, len, vals: run.join(" → "), ...extra }));
    };
    check(v => v === 20, MIN_CRIT_STREAK, "CRIT", "fa-bolt", "crit");
    check(v => v === 1, MIN_FUMBLE_STREAK, "FUMBLE", "fa-skull", "fumble");
    const last = vals.at(-1);
    if (last !== 1 && last !== 20) check(v => v === last, MIN_SAME, "SAME", "fa-clone", "same", { n: last });
    check(v => v >= HOT_MIN, MIN_HOT, "HOT", "fa-fire", "hot", { min: HOT_MIN }, r => r.every(v => v === 20));
    check(v => v <= COLD_MAX, MIN_COLD, "COLD", "fa-snowflake", "cold", { max: COLD_MAX }, r => r.every(v => v === 1));
  }

  // Awards: announce when an award changes hands (or is first earned).
  const stats = computeStats([session.rolls], { minD20: game.settings.get(MOD, "minD20") });
  for (const a of stats.awards) {
    if (!LIVE_AWARDS.has(a.id)) continue;
    if ((a.id === "Crit" || a.id === "Fumble") && a.raw < 2) continue;
    if (lastWinners.get(a.id) === a.winner) continue;
    lastWinners.set(a.id, a.winner);
    await post(a.icon, `award award-${a.id}`,
      `<b>${esc(a.title)}</b> — ${esc(a.winner)}. ${esc(a.value)}`);
  }
}
