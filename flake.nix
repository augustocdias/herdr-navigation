{
  description = "Smart tab titles and agent-state navigation for Herdr App";

  outputs = _: {
    homeManagerModules.default = import ./home-manager.nix;
    lib.keys = builtins.fromJSON (builtins.readFile ./keys.json);
  };
}
