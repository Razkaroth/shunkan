{
  description = "A flake for Shunkan local development";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, flake-utils, nixpkgs }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          config.allowUnfree = true;
          inherit system;
        };
        utils = import ./utils.nix { inherit pkgs; };
      in
      {
        apps = utils.apps;

        packages = utils.packages;

        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.git
            pkgs.openssl
          ] ++ utils.devShellPackages;
          shell = pkgs.bash;

          shellHook = ''
            mkdir -p .direnv/bin
            cat > .direnv/bin/pm2 <<'EOF'
#!/usr/bin/env sh
# Nix mkShell exports `name`; PM2 treats that as a process name. Unset it,
# then exec the next `pm2` on PATH (npm -g, distro, …) — never this shim.
self_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -vx "$self_dir" | paste -sd: -)
export PATH
pm2_bin=$(command -v pm2 || true)
if [ -z "$pm2_bin" ] || [ "$pm2_bin" = "$self_dir/pm2" ]; then
  printf 'pm2: no parent pm2 on PATH (install with: npm i -g pm2)\n' >&2
  exit 127
fi
exec env -u name "$pm2_bin" "$@"
EOF
            chmod +x .direnv/bin/pm2
            case ":$PATH:" in
              *":$PWD/.direnv/bin:"*) ;;
              *) export PATH="$PWD/.direnv/bin:$PATH" ;;
            esac
          '';
        };
      });
}
