import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, run, openOverlay, theme, window, shared, layout, settings, machines, appHome, readTextFile, notify } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.pinned = [];
    this.opening = new Map();
    this.movedAt = 0;
    // A Home Manager rebuild replaces this file, which reloads the mod.
    cx.spawn(async (cx) => {
      try {
        this.pinned = parsePinned(await readTextFile(`${appHome()}/mods/tabs-enriched/pinned.json`));
      } catch (error) {
        notify({ title: "Smart Tabs: pinned.json ignored", body: String(error?.message ?? error), level: "warning" });
      }
      cx.notify();
    });
  }

  syncPinned(space, plan) {
    if (machines().find(m => m.name === space.machine)?.layout !== "ready") return;
    const commands = pinnedCommands(plan, space, this.opening);
    // Moves wait a second for spaces() to catch up, so a lagging list doesn't repeat them.
    const moveNow = Date.now() > this.movedAt + 1000;
    for (const [name, args] of commands) {
      if (name === "tab.move" && !moveNow) continue;
      if (name === "tab.move") this.movedAt = Date.now();
      run(name, args);
    }
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const paneList = panes();
    const terminalMap = new Map(terminals().map(t => [t.address, t]));
    const plan = space && this.pinned.length ? pinnedPlan(this.pinned, space, paneList) : null;
    if (plan) this.syncPinned(space, plan);
    const pinned = plan?.pinned ?? new Set();
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const pin = pinned.has(c.id);
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const title = tabTitle(c, paneList, terminalMap);
    const name = title.text;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = pin ? null : i; if (e.click_count === 2 && !pin) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(pin, el => el.child(div().w(3).h(12).rounded(2).flex_none().bg(t.accent)))
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(480).truncate().tooltip(title.full).child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active && !pin, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    // Mods in the shown tab may add top-right controls (see README: Pinned tabs).
    const activeTab = shown.find(c => c.active);
    const controls = [...new Set(paneList.filter(p => p.tab === activeTab?.id && p.mod).map(p => p.mod))]
      .flatMap(mod => [].concat(shared(`tab-controls:${mod}`) ?? []).filter(c => typeof c?.label === "string" && typeof c.command === "string").map(c => ({ ...c, mod })));
    const control = c => h_flex().id(`control-${c.mod}-${c.id ?? c.label}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(c.active ? t.selected : t.chrome).text_color(c.active ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click(() => run(c.command, c.args ?? {}))
      .when(typeof c.icon === "string", el => el.child(svg(c.icon).size(14))).child(c.label);
    const tabs = shown.flatMap((c, i) => {
      const el = item(c, i);
      return pinned.has(c.id) && !pinned.has(shown[i + 1]?.id) && i + 1 < shown.length ? [el, div().w(1).h(18).mx(3).flex_none().bg(t.border)] : [el];
    });
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(tabs))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .children(controls.map(control))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}



// pinned.json: [{ label, mod }]. A pinned tab is the space's tab with that
// name holding a pane of that mod; renaming it unpins it.
export function parsePinned(text) {
  if (text === null) return [];
  const list = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error("pinned.json must be a list");
  const pinned = new Map();
  for (const p of list) {
    if (typeof p?.label === "string" && p.label && typeof p.mod === "string" && p.mod) pinned.set(`${p.mod}\n${p.label}`, { label: p.label, mod: p.mod });
  }
  return [...pinned.values()];
}

export function pinnedPlan(entries, space, paneList) {
  const found = entries.map(p => space.tabs.find(t => t.name === p.label && paneList.some(x => x.tab === t.id && x.mod === p.mod)));
  const present = found.filter(Boolean);
  return {
    entries,
    found,
    pinned: new Set(present.map(t => t.id)),
    missing: entries.filter((_p, i) => !found[i]),
    moves: present.some((t, i) => t.index !== i + 1) ? present.map((t, i) => ({ id: t.id, index: i + 1 })) : [],
  };
}

// Commands that open each missing pinned tab once per space, give back the tab the
// person was on (tab.new selects the new tab), and keep pinned tabs first. `opening`
// maps what was asked for to that tab until the pinned tab shows up; a tab.new that
// fails (say, the mod isn't installed) is not retried until the mod reloads.
export function pinnedCommands(plan, space, opening) {
  const active = space.tabs.find(t => t.active)?.id;
  const commands = [];
  plan.entries.forEach((p, i) => {
    const key = `${space.id}\n${p.mod}\n${p.label}`, tab = plan.found[i];
    if (!tab) {
      if (opening.has(key)) return;
      opening.set(key, active);
      commands.push(["tab.new", { space: space.id, name: p.label, mod: p.mod }]);
      return;
    }
    if (!opening.has(key)) return;
    const back = opening.get(key);
    opening.delete(key);
    if (tab.id === active && back && back !== tab.id) commands.push(["tab.select", { id: back }]);
  });
  if (!plan.missing.length) commands.push(...plan.moves.map(m => ["tab.move", m]));
  return commands;
}

// Labels survive Core recovery; only a live reporter's lease may reach the UI.
function activity(terminal, now = Date.now()) {
  if (terminal?.state !== "live") return null;
  try {
    const data = JSON.parse(terminal.labels?.["nix.activity"] ?? "null");
    if (data?.version !== 1 || !Number.isFinite(data.expires) || data.expires <= now) return null;
    if (terminal.program?.key !== data.agent) return null;
    const tokens = data.tokens;
    if (!tokens || ["agent", "title", "todo", "sub1", "sub2", "sub3", "submore"].some(k => typeof tokens[k] !== "string" || tokens[k].length > 80)) return null;
    return tokens;
  } catch {
    return null;
  }
}

function tabTitle(tab, paneList, terminalMap) {
  const members = paneList.filter(p => p.tab === tab.id);
  // terminal.open stores its launch program as a name even without an explicit rename.
  const launchName = tab.name === 'shell' || members.some(p => [p.program?.key, p.program?.name].includes(tab.name));
  const full = tab.named && !launchName ? tab.name : members.map(p => {
    const program = p.program?.name || p.mod || 'Terminal';
    const terminal = terminalMap.get(p.terminal);
    const title = p.program?.agent ? (activity(terminal)?.title || terminal?.report?.title || p.title || '').replace(/\s+/g, ' ').trim() : '';
    return title && title !== program ? `${program} · ${title}` : program;
  }).join(' | ') || tab.name;
  const characters = Array.from(full);
  return { full, text: characters.length > 80 ? `${characters.slice(0, 79).join('')}…` : full };
}
