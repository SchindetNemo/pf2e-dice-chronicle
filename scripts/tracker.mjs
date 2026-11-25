import { MOD, addRoll } from "./store.mjs";
import { announce } from "./announcer.mjs";

const D20_EXCLUDED = new Set(["damage-roll", "healing-roll"]);

/** Convert a ChatMessage into a compact roll entry, or null if it should be ignored. */
export function extractEntry(message) {
  const rolls = message.rolls ?? [];
  if (!rolls.length) return null;
  const user = message.author;
  if (!user) return null;
  if (user.isGM && !game.settings.get(MOD, "trackGM")) return null;

  const ctx = message.flags?.pf2e?.context ?? {};
  const type = ctx.type ?? null;
  const isDamage = D20_EXCLUDED.has(type);

  let dice = 0, diceSum = 0;
  const naturals = [];
  for (const roll of rolls) {
    if (!roll?.terms) continue;
    for (const term of roll.dice ?? []) {
      const results = term.results ?? [];
      dice += results.length;
      for (const r of results) diceSum += Number(r.result) || 0;
      if (term.faces === 20 && !isDamage && results.length) {
        const kept = results.find(r => r.active !== false && !r.discarded) ?? results[0];
        naturals.push(kept.result);
      }
    }
  }
  if (!dice && !naturals.length) return null;

  const actor = game.actors?.get(message.speaker?.actor);
  return {
    id: message.id,
    ts: message.timestamp ?? Date.now(),
    u: user.id,
    un: user.name,
    an: actor?.name ?? message.speaker?.alias ?? null,
    ty: type,
    ot: ctx.outcome ?? null,
    tot: rolls[0]?.total ?? 0,
    d: dice,
    ds: diceSum,
    n: naturals
  };
}

/**
 * Resolves once the roll message is visible to players: after Dice So Nice finishes
 * animating it (or a 12s safety timeout), plus a short configurable pause.
 */
function whenRevealed(messageId) {
  return new Promise(resolve => {
    const pause = () => setTimeout(resolve, game.settings.get(MOD, "announceDelay"));
    const dsn = game.dice3d;
    if (!dsn || dsn.isEnabled?.() === false) return pause();
    let done = false, timer, hookId;
    const finish = () => {
      if (done) return;
      done = true; clearTimeout(timer); Hooks.off("diceSoNiceRollComplete", hookId); pause();
    };
    hookId = Hooks.on("diceSoNiceRollComplete", id => { if (id === messageId) finish(); });
    timer = setTimeout(finish, 12000);
  });
}

export function initTracker() {
  Hooks.on("createChatMessage", (message) => {
    // Only one client (the active GM) records, so nothing is double counted.
    if (!game.users.activeGM?.isSelf) return;
    try {
      const entry = extractEntry(message);
      if (!entry) return;
      // Blind / private / self rolls are still recorded, but never announced in public chat.
      const secret = !!message.blind || (message.whisper?.length ?? 0) > 0;
      const revealed = whenRevealed(message.id); // listen before the animation can finish
      addRoll(entry).then(async live => { if (live) { await revealed; await announce(entry, live, { secret }); } });
    } catch (err) {
      console.error(`${MOD} | failed to track message`, err);
    }
  });
}
