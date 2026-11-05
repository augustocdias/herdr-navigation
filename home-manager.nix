{
  config,
  lib,
  ...
}: let
  cfg = config.programs.herdr-navigation;
in {
  options.programs.herdr-navigation.pinnedTabs = lib.mkOption {
    type = lib.types.listOf (lib.types.submodule {
      options = {
        label = lib.mkOption {
          type = lib.types.nonEmptyStr;
          description = "Name of the pinned tab; Smart Tabs finds the tab by this name.";
        };
        mod = lib.mkOption {
          type = lib.types.nonEmptyStr;
          description = "Mod that provides the tab's view.";
        };
      };
    });
    default = [];
    example = [
      {
        label = "Board";
        mod = "my-board";
      }
    ];
    description = "Tabs Smart Tabs opens in every space, first and in this order.";
  };

  config.xdg.configFile =
    {
      "herdr-app/mods/tabs-enriched/main.js".source = ./navigation/mods/tabs-enriched/main.js;
      "herdr-app/mods/tabs-enriched/mod.json".source = ./navigation/mods/tabs-enriched/mod.json;
      "herdr-app/mods/picker-enriched/main.js".source = ./navigation/mods/picker-enriched/main.js;
      "herdr-app/mods/picker-enriched/mod.json".source = ./navigation/mods/picker-enriched/mod.json;
      "herdr-app/mods/spaces-enriched/main.js".source = ./navigation/mods/spaces-enriched/main.js;
      "herdr-app/mods/spaces-enriched/mod.json".source = ./navigation/mods/spaces-enriched/mod.json;
      "herdr-app/mods/space-open/main.js".source = ./navigation/mods/space-open/main.js;
      "herdr-app/mods/space-open/mod.json".source = ./navigation/mods/space-open/mod.json;
    }
    // lib.optionalAttrs (cfg.pinnedTabs != []) {
      "herdr-app/mods/tabs-enriched/pinned.json".text = builtins.toJSON cfg.pinnedTabs;
    };
}
