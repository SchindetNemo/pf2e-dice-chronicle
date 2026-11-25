import { MOD, allSessions, startSession, endSession, renameSession, deleteSession, deleteRoll, resetAll } from "./store.mjs";
import { computeStats, describeMoment } from "./stats.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const L = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

export class ChronicleApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "pf2e-dice-chronicle",
    classes: ["chronicle"],
    position: { width: 860, height: 740 },
    window: { title: "CHRONICLE.Title", icon: "fa-solid fa-dice-d20", resizable: true },
    actions: {
      setView: ChronicleApp.#onSetView,
      toggleDiceScope: ChronicleApp.#onToggleScope,
      startSession: ChronicleApp.#onStart,
      endSession: ChronicleApp.#onEnd,
      renameSession: ChronicleApp.#onRename,
      deleteSession: ChronicleApp.#onDelete,
      exportSession: ChronicleApp.#onExport,
      deleteRoll: ChronicleApp.#onDeleteRoll,
      resetAll: ChronicleApp.#onResetAll
    }
  };

  static PARTS = { body: { template: `modules/${MOD}/templates/chronicle.hbs`, scrollable: [".chronicle-scroll"] } };

  view = "session";
  sessionId = null;
  diceScope = "campaign"; // dice tab defaults to campaign data

  /** Whether the stats shown come from the whole campaign rather than one session. */
  get useCampaign() {
    return this.view === "campaign" || (this.view === "dice" && this.diceScope === "campaign");
  }

  static open() {
    if (!game.user.isGM && !game.settings.get(MOD, "playerAccess")) {
      return ui.notifications.warn(L("CHRONICLE.NoAccess"));
    }
    this.instance ??= new ChronicleApp();
    this.instance.render({ force: true });
    return this.instance;
  }

  static refresh() {
    if (this.instance?.rendered) this.instance.render();
  }

  get session() {
    const sessions = allSessions();
    return sessions.find(s => s.id === this.sessionId)
      ?? sessions.find(s => !s.end) ?? sessions.at(-1) ?? null;
  }

  /** Sessions tab: every GM token is its own "player", listed after the human players. */
  #sessionRollSets(session) {
    if (!session) return [];
    if (this.view !== "session") return [session.rolls];
    const token = L("CHRONICLE.GMToken");
    return [session.rolls.map(r => (game.users.get(r.u)?.isGM
      ? { ...r, u: `${r.u}:${r.an ?? ""}`, un: r.an ?? r.un, an: token, g: true } : r))];
  }

  async _prepareContext() {
    const sessions = allSessions();
    const session = this.session;
    const minD20 = game.settings.get(MOD, "minD20");
    const isCampaign = this.view === "campaign";
    const isDice = this.view === "dice";
    const useCampaign = this.useCampaign;

    const stats = useCampaign
      ? computeStats(sessions.map(s => s.rolls), { minD20: minD20 * 2 })
      : computeStats(this.#sessionRollSets(session), { minD20 });
    if (this.view === "session") {
      // Awards and events treat the GM as one combined player; only the player list splits GM tokens.
      if (session) {
        const combined = computeStats([session.rolls], { minD20 });
        stats.awards = combined.awards;
        stats.moments = combined.moments;
      }
      stats.players.sort((a, b) => Number(a.gm) - Number(b.gm) || b.rolls - a.rolls);
    }

    // Campaign tab: events are sorted longest-first, so keep only the best of each kind.
    if (isCampaign) {
      const seen = new Set();
      stats.moments = stats.moments.filter(m => !seen.has(m.type) && seen.add(m.type));
    }

    // The GM's token names would swamp the Campaign and Dice tabs, so hide them there (GM only).
    if (isCampaign || isDice) {
      stats.players = stats.players.map(p => (game.users.get(p.id)?.isGM ? { ...p, characters: "" } : p));
    }

    const options = [...sessions].reverse().map(s => ({
      id: s.id, selected: s.id === session?.id,
      label: `${s.end ? "" : "● "}${s.name} (${s.rolls.length})`
    }));

    const rolls = (!useCampaign && !isDice && session ? session.rolls.slice(-40).reverse() : []).map(r => ({
      id: r.id,
      time: new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      who: r.un, char: r.an ?? "", type: r.ty ?? "roll", total: r.tot, dice: r.d,
      nat: r.n?.join(", ") ?? "",
      cls: r.n?.includes(20) ? "crit" : r.n?.includes(1) ? "fumble" : ""
    }));

    // Dice tab: histogram of every natural d20 result, per player and for the whole table
    const bars = (hist) => {
      const max = Math.max(1, ...hist), tot = hist.reduce((a, b) => a + b, 0);
      return hist.map((c, i) => ({
        n: i + 1, c, pct: Math.round((c / max) * 100), share: tot ? Math.round((c / tot) * 1000) / 10 : 0,
        cls: i === 19 ? "crit" : i === 0 ? "fumble" : ""
      }));
    };
    const favorite = (hist) => {
      const max = Math.max(...hist);
      return max ? hist.map((c, i) => (c === max ? i + 1 : null)).filter(Boolean).join(", ") : "–";
    };
    const tableHist = Array(20).fill(0);
    for (const p of stats.players) p.hist.forEach((c, i) => (tableHist[i] += c));
    const dicePlayers = isDice ? stats.players.filter(p => p.d20s > 0).sort((a, b) => b.d20s - a.d20s)
      .map(p => ({
        ...p, bars: bars(p.hist), favorite: favorite(p.hist)
      })) : [];
    const table = isDice && tableHist.some(Boolean)
      ? { bars: bars(tableHist), favorite: favorite(tableHist), d20s: tableHist.reduce((a, b) => a + b, 0) } : null;

    return {
      isDice, diceCampaign: this.diceScope === "campaign", dicePlayers, table,
      isGM: game.user.isGM,
      isCampaign, view: this.view,
      hasSession: !!session, session,
      isLive: !!session && !session.end,
      hasLive: sessions.some(s => !s.end),
      sessionOptions: options,
      sessionRange: session ? [new Date(session.start).toLocaleString(),
        session.end ? new Date(session.end).toLocaleString() : L("CHRONICLE.Session.Ongoing")].join(" → ") : "",
      sessionCount: sessions.length,
      stats, hasData: stats.totals.rolls > 0,
      awards: stats.awards,
      moments: stats.moments.slice(0, useCampaign ? 15 : 12).map(describeMoment),
      players: stats.players, rolls, minD20: useCampaign ? minD20 * 2 : minD20
    };
  }

  _onRender() {
    this.element.querySelector("select[name=session]")?.addEventListener("change", ev => {
      this.sessionId = ev.target.value;
      this.render();
    });
  }

  static #onToggleScope() { this.diceScope = this.diceScope === "campaign" ? "session" : "campaign"; this.render(); }
  static #onSetView(ev, target) { this.view = target.dataset.view; this.render(); }
  static async #onStart() {
    const name = await DialogV2.prompt({
      window: { title: L("CHRONICLE.Session.Start") },
      content: `<div class="form-group"><label>${L("CHRONICLE.Session.Name")}</label>
        <input type="text" name="name" placeholder="${L("CHRONICLE.Session.OptionalName")}"></div>`,
      ok: { label: L("CHRONICLE.Session.Start"), callback: (e, b) => b.form.elements.name.value.trim() },
      rejectClose: false
    });
    if (name === undefined || name === null) return;
    await startSession(name);
    this.sessionId = null;
  }
  static async #onEnd() {
    const ok = await DialogV2.confirm({
      window: { title: L("CHRONICLE.Session.End") }, content: `<p>${L("CHRONICLE.Session.EndConfirm")}</p>`
    });
    if (!ok) return;
    this.sessionId = null;
    await endSession();
  }
  static async #onRename() {
    const s = this.session; if (!s) return;
    const name = await DialogV2.prompt({
      window: { title: L("CHRONICLE.Session.Rename") },
      content: `<div class="form-group"><label>${L("CHRONICLE.Session.Name")}</label>
        <input type="text" name="name" value="${foundry.utils.escapeHTML(s.name)}" autofocus></div>`,
      ok: { label: L("CHRONICLE.Save"), callback: (e, b) => b.form.elements.name.value.trim() },
      rejectClose: false
    });
    if (name) await renameSession(s.id, name);
  }
  static async #onDelete() {
    const s = this.session; if (!s) return;
    const ok = await DialogV2.confirm({
      window: { title: L("CHRONICLE.Session.Delete") },
      content: `<p>${L("CHRONICLE.Session.DeleteConfirm", { name: foundry.utils.escapeHTML(s.name) })}</p>`
    });
    if (!ok) return;
    this.sessionId = null;
    await deleteSession(s.id);
  }
  static #onExport() {
    const sessions = this.useCampaign ? allSessions() : [this.session].filter(Boolean);
    if (!sessions.length) return;
    const name = this.useCampaign ? "campaign" : sessions[0].name.slugify();
    foundry.utils.saveDataToFile(JSON.stringify(sessions, null, 2), "application/json", `dice-chronicle-${name}.json`);
  }
  static async #onDeleteRoll(ev, target) {
    const s = this.session; if (s) await deleteRoll(s.id, target.dataset.id);
  }
  static async #onResetAll() {
    const ok = await DialogV2.confirm({
      window: { title: L("CHRONICLE.Reset.Title") }, content: `<p>${L("CHRONICLE.Reset.Confirm")}</p>`
    });
    if (ok) { this.sessionId = null; await resetAll(); }
  }
}
