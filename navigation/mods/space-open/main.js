// Opens a space the way the herdr-workspace and herdr-worktree scripts do.
// Props { action: "workspace" } picks a folder; { action: "worktree", folder }
// asks for a branch of the repo at folder and checks it out at
// <repo folder>/<branch>. Both select a local space already made in that
// folder, and ask before trusting a folder's own .envrc that direnv has not
// allowed yet.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, exec, pickFolder } from "herdr";

const basename = (path) => path.replace(/\/+$/, "").split("/").pop();
const dirname = (path) => path.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";

// Main checkouts kept as <repo>/<branch> are told apart as repo/branch;
// linked worktrees and folders outside git use their own name.
// `g`: { common, gitdir, origin } from git, or null outside git.
export function labelFor(dir, g) {
  const name = basename(dir);
  if (!g || g.gitdir !== g.common) return name;
  const repo = basename(g.origin).replace(/\.git$/, "") || basename(dirname(dirname(g.common)));
  return repo === name ? name : `${repo}/${name}`;
}

// The checkout of `branch` in `git worktree list --porcelain`, else null.
export function worktreeFor(porcelain, branch) {
  let candidate = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) candidate = line.slice(9);
    else if (line === `branch refs/heads/${branch}`) return candidate;
  }
  return null;
}

// `direnv status --json` found dir's own .envrc and it isn't allowed (0 is allowed).
export function needsAllow(status, dir) {
  const rc = status?.state?.foundRC;
  return Boolean(rc) && rc.path === `${dir}/.envrc` && rc.allowed !== 0;
}

async function git(cwd, args) {
  const r = await exec("git", args, { cwd });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

export default class SpaceOpen extends View {
  init(_props, cx) {
    this.step = props()?.action === "worktree" ? "branch" : "pick";
    this.busy = false;
    this.error = "";
    this.text = "";
    this.input = InputState.new({ placeholder: "branch name" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(cx, (cx) => this.worktree(cx)));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.step === "branch" && this.input.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      if (this.step === "pick") {
        const picked = await pickFolder({ prompt: "Open" });
        if (!picked) return this.close();
        // Resolved like the script's `path resolve`, so a symlinked pick finds its space.
        return this.go(cx, async (cx) => this.open((await exec("realpath", ["--", picked])).stdout.trim() || picked, "", cx));
      }
      const folder = props()?.folder;
      const common = folder ? await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) : null;
      if (!folder) this.error = "No active space on this computer.";
      else if (!common.ok) this.error = `${folder} is not inside a git work tree.`;
      else this.repo = { start: folder, folder: dirname(dirname(common.out)) };
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  // `work(cx)` gets a task cx: an event's cx is gone once its callback returns.
  go(cx, work) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try { this.error = await work(cx); }
      catch (error) { this.error = String(error); }
      this.busy = false;
      cx.notify();
    });
  }

  // Returns an error, or "" once the space is shown or the allow question is up.
  async worktree(cx) {
    const branch = this.text.trim();
    if (!this.repo || !branch) return "";
    const { start, folder } = this.repo;
    const list = await git(start, ["worktree", "list", "--porcelain"]);
    if (!list.ok) return list.err || "git worktree list failed.";
    let checkout = worktreeFor(list.out, branch);
    if (checkout) {
      // Already a worktree of this repo: reuse it instead of touching git.
      if ((await exec("test", ["-d", checkout])).code !== 0) return `${checkout} is registered but missing, run: git worktree prune`;
    } else {
      const target = `${folder}/${branch}`;
      if ((await exec("test", ["-e", target])).code === 0) return `${target} exists but is not a worktree of this repo, run: git worktree prune`;
      // An existing branch is checked out untouched, never reset to HEAD.
      const exists = (await git(start, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
      const add = await git(start, ["worktree", "add", target, ...(exists ? [branch] : ["-b", branch])]);
      if (!add.ok) return add.err || `git worktree add ${target} failed.`;
      // Trust git's own view of where the checkout landed.
      checkout = worktreeFor((await git(start, ["worktree", "list", "--porcelain"])).out, branch);
      if (!checkout) return `Could not locate the new checkout for ${branch}.`;
    }
    return this.open(checkout, branch, cx);
  }

  async open(dir, label, cx) {
    let status = null;
    try {
      const r = await exec("direnv", ["status", "--json"], { cwd: dir });
      if (r.code === 0) status = JSON.parse(r.stdout);
    } catch {} // no direnv: nothing to allow
    if (!needsAllow(status, dir)) return this.show(dir, label);
    this.pending = { dir, label };
    this.step = "allow";
    this.handle.focus();
    cx.notify();
    return "";
  }

  async allow(trust) {
    const { dir, label } = this.pending;
    if (trust) {
      const r = await exec("direnv", ["allow", dir]);
      if (r.code !== 0) return (r.stderr ?? "").trim() || "direnv allow failed.";
    }
    return this.show(dir, label);
  }

  // An explicit label also renames an existing space; a derived one never does.
  async show(dir, label) {
    const existing = spaces().find((s) => s.folder === dir && !s.machine);
    if (existing) {
      run("space.select", { id: existing.id });
      if (label) run("space.rename", { id: existing.id, name: label });
    } else {
      let g = null;
      const common = await git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      if (common.ok) {
        const gitdir = await git(dir, ["rev-parse", "--path-format=absolute", "--git-dir"]);
        g = { common: common.out, gitdir: gitdir.out, origin: (await git(dir, ["remote", "get-url", "origin"])).out };
      }
      run("space.new", { folder: dir, name: label || labelFor(dir, g) });
    }
    this.close();
    return "";
  }

  key(e, cx) {
    if (e.key === "escape") this.close();
    else if (e.key === "enter" && this.step === "allow") this.go(cx, () => this.allow(true));
    else return;
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    const allowing = this.step === "allow";
    const button = (id, label, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(label);
    const title = allowing ? "Allow .envrc?" : this.step === "pick" ? "Open workspace" : "New worktree";
    const detail = allowing
      ? `${this.pending.dir}/.envrc is not allowed yet. Allowing lets direnv run it in every shell started there.`
      : this.step === "pick"
        ? "Choose a folder…"
        : this.repo
          ? `Checks out ${this.repo.folder}/<branch>. A worktree that exists is reused, a branch that exists is checked out as is, a new one starts from HEAD.`
          : "";
    return v_flex()
      .id("space-open")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(this.step === "branch" && Boolean(this.repo), (el) =>
        el.child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .when(allowing, (el) => el.child(h_flex().gap(8).justify_end()
        .child(button("so-cancel", "Cancel", false, () => this.close()))
        .child(button("so-open", "Open only", false, (_e, cx) => this.go(cx, () => this.allow(false))))
        .child(button("so-allow", "Allow & open", true, (_e, cx) => this.go(cx, () => this.allow(true))))))
      .when(!allowing, (el) => el.child(h_flex().justify_end().text_size(11).text_color(t.dim)
        .child(this.busy ? "working…" : this.step === "branch" && this.repo ? "↵ create · esc cancel" : "esc close")));
  }
}
