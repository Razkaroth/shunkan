{ pkgs }:
let
  dev = pkgs.writeShellScriptBin "dev" ''
    #!${pkgs.bash}/bin/bash
    set -euo pipefail

    root="$(${pkgs.git}/bin/git rev-parse --show-toplevel 2>/dev/null || true)"
    if [ -z "$root" ]; then
      printf 'dev: not inside a git worktree\n' >&2
      exit 1
    fi
    if [ ! -f "$root/devenv/dev.sh" ]; then
      printf 'dev: devenv/dev.sh not found in %s\n' "$root" >&2
      exit 1
    fi

    exec ${pkgs.bash}/bin/bash "$root/devenv/dev.sh" "$@"
  '';
in
{
  packages = {
    inherit dev;
  };

  apps = {
    dev = {
      type = "app";
      program = "${dev}/bin/dev";
    };
  };

  devShellPackages = [
    dev
    pkgs.mongodb-tools
    pkgs.zip
    pkgs.unzip
  ];
}
