# Herdr Navigation

Mods for Herdr App: Smart Tabs, Agent Picker, and Space Shortcuts. They use the App's mod API and require no Rust patches or changes to herdr-core.

![Smart Tabs and Agent Picker](navigation/preview.png)

## Smart Tabs

Each terminal pane contributes its program name. Agent panes also show their session title when available. Multiple panes are joined with ` | ` in pane order. Labels are capped at 80 Unicode code points, including the ellipsis, and at 480 pixels; the tooltip contains the full title.

Descriptive saved tab names take precedence. Herdr stores `shell` and launch-program names as named tabs, so those names are treated as automatic. A manual name equal to a current program name has the same treatment. Clear a saved name to return to automatic titles. Display updates do not rename tabs or write layout state.

Agent title sources, in priority order:

1. A valid, unexpired `nix.activity` integration label, when installed.
2. The agent's native OSC 7501 report title.
3. The terminal title set by the program.

No integration label is required. If an agent reports no title, the tab shows its program name. Mod panes show their mod identifier.

## Agent Picker

Open `picker-enriched` to search tabs by their displayed titles, saved names, space names, and agent program names. State filters combine with the text query.

| Shortcut | Filter |
| --- | --- |
| Ctrl+1 | All tabs |
| Ctrl+2 | Working |
| Ctrl+3 | Needs you |
| Ctrl+4 | Done |
| Ctrl+5 | Idle |

The filter chips are clickable. A tab matches if any of its agents has the selected state, even when another agent determines the tab's aggregate status. Shell-only tabs appear only under All. Herdr changes Done to Idle after you view the agent.

Arrow keys select a row, Enter opens it, Escape closes the picker, and Ctrl+D closes the selected tab. New-tab and new-space actions remain available, including when no agent matches.

## Space Shortcuts

`spaces-enriched` is Herdr's spaces sidebar with two buttons before the local `+`. When another machine is known, the buttons sit on the This computer row; otherwise they sit in the Spaces header. The narrow sidebar rail hides them. They work only on this computer.

Open workspace asks for a folder in the system folder picker. If a local space was made in that folder, Herdr selects it. Otherwise it opens a new space named after the folder. A main checkout kept as `<repo>/<branch>` is named `repo/branch`.

New worktree asks for a branch of the repository where the active space's first terminal is. A worktree that already has the branch is reused. An existing branch is checked out unchanged, and a new branch starts from HEAD. New checkouts go to `<repo folder>/<branch>`, next to the main checkout. The space is named after the branch, and an existing space in that checkout is renamed to it.

Before opening a folder whose own `.envrc` direnv has not allowed, the `space-open` dialog asks first. Allow & open runs `direnv allow`, Open only opens the space without it, and Cancel opens nothing. Without direnv installed, the dialog skips this step.

## Install with Nix

Add this repository as a flake input named `herdr-navigation`, then import its Home Manager module:

```nix
imports = [inputs.herdr-navigation.homeManagerModules.default];
```

The module installs only the mods. It does not replace your keys, settings, layouts, or runtime state.

Merge `inputs.herdr-navigation.lib.keys` into your existing Nix-managed key object with `lib.recursiveUpdate`. The fragment opens the picker with Alt+W and suppresses Herdr's default Ctrl+1–5 navigation only inside the picker, allowing those keys to reach its state filters. Preserve the rest of your key configuration.

In your chosen layout, replace the tabs block's mod identifier `tabs` with `tabs-enriched`, and the spaces block's `spaces` with `spaces-enriched`. Keep both changes declarative and rebuild your system or Home Manager configuration to apply them.

The optional `navigation/layouts/navigation.json` provides a complete layout based on Herdr's main layout. To install it through Home Manager:

```nix
xdg.configFile."herdr-app/layouts/navigation.json".source =
  "${inputs.herdr-navigation}/navigation/layouts/navigation.json";
```

Select the Navigation layout after activation if you installed it. Each mod ships as one JavaScript file so Home Manager store symlinks do not require relative JavaScript imports.

## Verification and publishing

Development checks used Herdr App 0.1.11 and Core 0.1.16 on Linux in a private display and Core session. The mod loader checks and live picker interactions ran through Nix-store file symlinks. No Windows or macOS runtime checks have been performed.

The preview uses synthetic agent reports, not private sessions. `node --test` checks the Space Shortcuts naming, worktree lookup, and direnv rules. Before updating the mods, run `herdr-app check` on each mod folder and exercise the visible App behavior in an isolated session. Keep the title helper in both self-contained modules consistent.

Herdr's community catalog discovers public GitHub repositories with the `herdr-layout` topic. The `navigation/` folder contains the layout, mods, recipe, and preview required by the catalog. Publishing the repository and setting the topic are separate from installing it locally.

Derived from Herdr App under Apache-2.0. See `NOTICE` and `LICENSE`.
