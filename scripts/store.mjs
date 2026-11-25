export const MOD = "pf2e-dice-chronicle";

/** Serialises all writes so rapid chat messages never race. */
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn).catch(err => console.error(`${MOD} |`, err)));

export const getLive = () => foundry.utils.deepClone(game.settings.get(MOD, "live"));
export const getArchive = () => foundry.utils.deepClone(game.settings.get(MOD, "archive") ?? []);

export function allSessions() {
  const live = game.settings.get(MOD, "live");
  const archive = game.settings.get(MOD, "archive") ?? [];
  return live ? [...archive, live] : [...archive];
}

function newSession(archiveCount) {
  const date = new Date().toLocaleDateString();
  return {
    id: foundry.utils.randomID(),
    name: game.i18n.format("CHRONICLE.Session.DefaultName", { n: archiveCount + 1, date }),
    start: Date.now(), end: null, rolls: []
  };
}

export function startSession(name) {
  return enqueue(async () => {
    if (game.settings.get(MOD, "live")) return;
    const s = newSession((game.settings.get(MOD, "archive") ?? []).length);
    if (name) s.name = name;
    await game.settings.set(MOD, "live", s);
  });
}

/** Number of users currently connected to the world. */
export const connectedCount = () => game.users.filter(u => u.active).length;

export function endSession({ discardEmpty = false } = {}) {
  return enqueue(async () => {
    const live = getLive();
    if (!live) return;
    if (discardEmpty && !live.rolls.length) return game.settings.set(MOD, "live", null);
    live.end = Date.now();
    const archive = getArchive();
    archive.push(live);
    await game.settings.set(MOD, "archive", archive);
    await game.settings.set(MOD, "live", null);
    Hooks.callAll(`${MOD}.sessionEnded`, live);
  });
}

export function addRoll(entry) {
  return enqueue(async () => {
    let live = getLive();
    if (!live) {
      // Sessions only auto-start while at least two people are connected.
      if (!game.settings.get(MOD, "autoStart") || connectedCount() < 2) return null;
      live = newSession((game.settings.get(MOD, "archive") ?? []).length);
    }
    if (live.rolls.some(r => r.id === entry.id)) return null;
    live.rolls.push(entry);
    await game.settings.set(MOD, "live", live);
    return live;
  });
}

export function renameSession(id, name) {
  return enqueue(async () => {
    const live = getLive();
    if (live?.id === id) return game.settings.set(MOD, "live", Object.assign(live, { name }));
    const archive = getArchive();
    const s = archive.find(x => x.id === id);
    if (s) { s.name = name; await game.settings.set(MOD, "archive", archive); }
  });
}

export function deleteSession(id) {
  return enqueue(async () => {
    if (game.settings.get(MOD, "live")?.id === id) return game.settings.set(MOD, "live", null);
    const archive = getArchive().filter(s => s.id !== id);
    await game.settings.set(MOD, "archive", archive);
  });
}

export function deleteRoll(sessionId, rollId) {
  return enqueue(async () => {
    const live = getLive();
    if (live?.id === sessionId) {
      live.rolls = live.rolls.filter(r => r.id !== rollId);
      return game.settings.set(MOD, "live", live);
    }
    const archive = getArchive();
    const s = archive.find(x => x.id === sessionId);
    if (s) { s.rolls = s.rolls.filter(r => r.id !== rollId); await game.settings.set(MOD, "archive", archive); }
  });
}

export function resetAll() {
  return enqueue(async () => {
    await game.settings.set(MOD, "live", null);
    await game.settings.set(MOD, "archive", []);
  });
}
