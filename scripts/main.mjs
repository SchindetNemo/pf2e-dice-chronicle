import { MOD, allSessions } from "./store.mjs";
import { initTracker } from "./tracker.mjs";
import { ChronicleApp } from "./app.mjs";
import { computeStats } from "./stats.mjs";
import * as store from "./store.mjs";
import { endSession, connectedCount, getLive } from "./store.mjs";

const L = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Settings-menu launcher: opens the chronicle instead of a form. */
class ChronicleLauncher extends foundry.applications.api.ApplicationV2 {
  async render() { ChronicleApp.open(); return this; }
}

Hooks.once("init", () => {
  const s = (key, data) => game.settings.register(MOD, key, { scope: "world", ...data });
  s("live", { config: false, type: Object, default: null, onChange: () => ChronicleApp.refresh() });
  s("archive", { config: false, type: Array, default: [], onChange: () => ChronicleApp.refresh() });
  s("trackGM", { name: "CHRONICLE.Setting.TrackGM", hint: "CHRONICLE.Setting.TrackGMHint",
    config: true, type: Boolean, default: false });
  s("autoStart", { name: "CHRONICLE.Setting.AutoStart", hint: "CHRONICLE.Setting.AutoStartHint",
    config: true, type: Boolean, default: true });
  s("autoEnd", { name: "CHRONICLE.Setting.AutoEnd", hint: "CHRONICLE.Setting.AutoEndHint",
    config: true, type: Boolean, default: true });
  s("autoEndGrace", { name: "CHRONICLE.Setting.AutoEndGrace", hint: "CHRONICLE.Setting.AutoEndGraceHint",
    config: true, type: Number, default: 60, range: { min: 0, max: 600, step: 15 } });
  s("announce", { name: "CHRONICLE.Setting.Announce", hint: "CHRONICLE.Setting.AnnounceHint",
    config: true, type: Boolean, default: true });
  s("announceDelay", { name: "CHRONICLE.Setting.AnnounceDelay", hint: "CHRONICLE.Setting.AnnounceDelayHint",
    config: true, type: Number, default: 800, range: { min: 0, max: 5000, step: 100 } });
  s("postAwards", { name: "CHRONICLE.Setting.PostAwards", hint: "CHRONICLE.Setting.PostAwardsHint",
    config: true, type: Boolean, default: true });
  s("playerAccess", { name: "CHRONICLE.Setting.PlayerAccess", hint: "CHRONICLE.Setting.PlayerAccessHint",
    config: true, type: Boolean, default: true, onChange: () => ChronicleApp.refresh() });
  s("minD20", { name: "CHRONICLE.Setting.MinD20", hint: "CHRONICLE.Setting.MinD20Hint",
    config: true, type: Number, default: 5, range: { min: 1, max: 50, step: 1 },
    onChange: () => ChronicleApp.refresh() });

  game.settings.registerMenu(MOD, "open", {
    name: "CHRONICLE.Title", label: "CHRONICLE.Open", hint: "CHRONICLE.Setting.OpenHint",
    icon: "fa-solid fa-dice-d20", type: ChronicleLauncher, restricted: false
  });

  game.keybindings.register(MOD, "open", {
    name: "CHRONICLE.Open", editable: [{ key: "KeyJ", modifiers: ["Alt"] }],
    onDown: () => { ChronicleApp.open(); return true; }
  });
});

/** Auto-end the live session once fewer than two people are connected (after a grace period). */
let endTimer = null;
function checkPresence() {
  if (!game.users.activeGM?.isSelf) return;
  const lonely = connectedCount() < 2;
  if (!lonely || !game.settings.get(MOD, "autoEnd") || !game.settings.get(MOD, "live")) {
    clearTimeout(endTimer); endTimer = null;
    return;
  }
  if (endTimer) return;
  endTimer = setTimeout(() => {
    endTimer = null;
    if (game.users.activeGM?.isSelf && connectedCount() < 2 && getLive()) endSession({ discardEmpty: true });
  }, game.settings.get(MOD, "autoEndGrace") * 1000);
}
Hooks.on("userConnected", () => setTimeout(checkPresence, 250));

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") console.warn(`${MOD} | designed for the pf2e system.`);
  initTracker();
  checkPresence();
  const mod = game.modules.get(MOD);
  mod.api = { open: () => ChronicleApp.open(), store, computeStats, sessions: allSessions };
});

// Scene control button
Hooks.on("getSceneControlButtons", (controls) => {
  const group = controls.tokens ?? controls.token ?? Object.values(controls)[0];
  if (!group?.tools) return;
  group.tools.diceChronicle = {
    name: "diceChronicle", title: "CHRONICLE.Title", icon: "fa-solid fa-dice-d20",
    order: 100, button: true, visible: true,
    onChange: () => ChronicleApp.open()
  };
});

// Post an awards summary to chat when the GM ends a session
Hooks.on(`${MOD}.sessionEnded`, (session) => {
  if (!game.settings.get(MOD, "postAwards") || !game.users.activeGM?.isSelf) return;
  const stats = computeStats([session.rolls], { minD20: game.settings.get(MOD, "minD20") });
  if (!stats.totals.rolls) return;
  const rows = stats.awards.map(a => `<li><b>${a.title}</b>: ${a.winner} <small>— ${a.value}</small></li>`).join("");
  ChatMessage.create({
    content: `<div class="chronicle-chat"><h3><i class="fa-solid fa-dice-d20"></i> ${foundry.utils.escapeHTML(session.name)}</h3>
      <p>${L("CHRONICLE.Chat.Summary", { rolls: stats.totals.rolls, dice: stats.totals.dice, crits: stats.totals.crits, fumbles: stats.totals.fumbles })}</p>
      <ul>${rows}</ul></div>`
  });
});
