{
  description = "Smart tab titles and agent-state navigation for Herdr App";

  outputs = _: {
    homeManagerModules.default = import ./home-manager.nix;
  };
}
