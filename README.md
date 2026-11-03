# Herdr Navigation

Two mods for Herdr App: Smart Tabs and Agent Picker. They use the App's mod API and require no Rust patches or changes to herdr-core.

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

## Install with Nix

Add this repository as a flake input named `herdr-navigation`, then import its Home Manager module:

```nix
imports = [inputs.herdr-navigation.homeManagerModules.default];
```

The module installs only the two mods. It does not replace your keys, settings, layouts, or runtime state.

In your existing Nix-managed key configuration, map `alt-w` to `mod.open:picker-enriched`. In your chosen layout, replace the tabs block's mod identifier `tabs` with `tabs-enriched`. Keep both changes declarative and rebuild your system or Home Manager configuration to apply them.

The optional `navigation/layouts/navigation.json` provides a complete layout based on Herdr's main layout. To install it through Home Manager:

```nix
xdg.configFile."herdr-app/layouts/navigation.json".source =
  "${inputs.herdr-navigation}/navigation/layouts/navigation.json";
```

Select the Navigation layout after activation if you installed it. Each mod ships as one JavaScript file so Home Manager store symlinks do not require relative JavaScript imports.

## Verification and publishing

Development checks used Herdr App 0.1.11 and Core 0.1.16 on Linux in a private display and Core session. The mod loader checks and live picker interactions ran through Nix-store file symlinks. No Windows or macOS runtime checks have been performed.

The preview uses synthetic agent reports, not private sessions. Before updating the mods, exercise both `herdr-app check` commands and the visible App behavior in an isolated session. Keep the title helper in both self-contained modules consistent.

Herdr's community catalog discovers public GitHub repositories with the `herdr-layout` topic. The `navigation/` folder contains the layout, mods, recipe, and preview required by the catalog. Publishing the repository and setting the topic are separate from installing it locally.

Derived from Herdr App under Apache-2.0. See `NOTICE` and `LICENSE`.
