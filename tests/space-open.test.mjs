// Run with `node --test`. Herdr's modules exist only inside the app, so
// they are stubbed: these checks cover the pure helpers, not the dialog.
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const stubs = {
  "gpui-kit": "export class View {} export const div = () => {}, svg = () => {};",
  "gpui-base": "export const v_flex = () => {}, h_flex = () => {}, Input = {}, InputState = {};",
  herdr: "export const run = () => {}, props = () => {}, closeOverlay = () => {}, theme = () => {}, spaces = () => [], panes = () => [], exec = async () => {}, pickFolder = async () => null;",
};
registerHooks({
  resolve: (specifier, context, next) =>
    specifier in stubs ? { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true } : next(specifier, context),
});
const { labelFor, worktreeFor, needsAllow } = await import("../navigation/mods/space-open/main.js");

test("a folder outside git is labelled with its name", () => {
  assert.equal(labelFor("/tmp/scratch", null), "scratch");
});

test("a linked worktree is labelled with its folder name", () => {
  assert.equal(labelFor("/code/repo/fix-login", { common: "/code/repo/main/.git", gitdir: "/code/repo/main/.git/worktrees/fix-login", origin: "git@host:me/repo.git" }), "fix-login");
});

test("a main checkout named like its repo keeps that name", () => {
  assert.equal(labelFor("/home/a/dev/herdr-navigation", { common: "/home/a/dev/herdr-navigation/.git", gitdir: "/home/a/dev/herdr-navigation/.git", origin: "git@github.com:me/herdr-navigation.git" }), "herdr-navigation");
});

test("a main checkout kept as <repo>/<branch> is labelled repo/branch", () => {
  assert.equal(labelFor("/code/repo/main", { common: "/code/repo/main/.git", gitdir: "/code/repo/main/.git", origin: "https://example.com/team/repo.git" }), "repo/main");
});

test("without an origin the repo name comes from the folder above the checkout", () => {
  assert.equal(labelFor("/code/repo/main", { common: "/code/repo/main/.git", gitdir: "/code/repo/main/.git", origin: "" }), "repo/main");
});

const porcelain = `worktree /code/repo/main
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /code/repo/feat/x
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat/x

worktree /code/repo/detached
HEAD 3333333333333333333333333333333333333333
detached
`;

test("the checkout of a branch is found in git worktree list", () => {
  assert.equal(worktreeFor(porcelain, "feat/x"), "/code/repo/feat/x");
  assert.equal(worktreeFor(porcelain, "main"), "/code/repo/main");
});

test("a branch with no checkout has none", () => {
  assert.equal(worktreeFor(porcelain, "feat"), null);
});

test("only the folder's own, not yet allowed .envrc asks first", () => {
  assert.equal(needsAllow({ state: { foundRC: { allowed: 1, path: "/a/.envrc" } } }, "/a"), true);
  assert.equal(needsAllow({ state: { foundRC: { allowed: 2, path: "/a/.envrc" } } }, "/a"), true);
  assert.equal(needsAllow({ state: { foundRC: { allowed: 0, path: "/a/.envrc" } } }, "/a"), false);
  assert.equal(needsAllow({ state: { foundRC: { allowed: 1, path: "/.envrc" } } }, "/a"), false);
  assert.equal(needsAllow({ state: { foundRC: null } }, "/a"), false);
});
