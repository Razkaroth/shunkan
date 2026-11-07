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

        # Official Node 24.22.2. Payload asks for ^22.23.4 || >=24.22.1, and
        # Node 22.23 still ships npm 10. pnpm 10.28.0 from this nixpkgs installs
        # the lock.
        nodeVersion = "24.22.2";
        nodeSrcs = {
          "x86_64-linux" = {
            url = "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-x64.tar.xz";
            hash = "sha256-SMwOIeBIeQ5UwM9XScJyUAUxPWUmUcQLeiH+uWl6r3U=";
          };
          "aarch64-linux" = {
            url = "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-arm64.tar.xz";
            hash = "sha256-6xh4N6IjDUBHFhrAvgCFhOFrRvcm6clJDuNdxrF9m6g=";
          };
          "x86_64-darwin" = {
            url = "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-darwin-x64.tar.gz";
            hash = "sha256-1eM21YjEW+DDfb1SzCmJVZMAnKSZeneh/QKBUTHtDlI=";
          };
          "aarch64-darwin" = {
            url = "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-darwin-arm64.tar.gz";
            hash = "sha256-qpVJNJ5H3/qkLc+V1uBq3oxL2vyYCXmIO4h2dnDfOFo=";
          };
        };
        nodeSrc = nodeSrcs.${system} or (throw "pinned node ${nodeVersion} has no binary for ${system}");
        nodePinned = pkgs.stdenv.mkDerivation {
          pname = "nodejs";
          version = nodeVersion;
          src = pkgs.fetchurl {
            inherit (nodeSrc) url hash;
          };
          nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            pkgs.autoPatchelfHook
          ];
          buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            pkgs.stdenv.cc.cc.lib
          ];
          dontConfigure = true;
          dontBuild = true;
          dontStrip = true;
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -a . $out
            runHook postInstall
          '';
        };
      in
      {
        apps = utils.apps;

        packages = utils.packages // {
          nodejs = nodePinned;
        };

        devShells.default = pkgs.mkShell {
          packages = [
            nodePinned
            pkgs.pnpm
            pkgs.git
            pkgs.openssl
          ] ++ utils.devShellPackages;
          shell = pkgs.bash;

          shellHook = ''
            mkdir -p .direnv/bin
            cat > .direnv/bin/pm2 <<'EOF'
#!/usr/bin/env sh
# Nix mkShell exports `name`; PM2 treats that as a process name. Unset it,
# then exec the next `pm2` on PATH (pnpm -g, distro, …) — never this shim.
self_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -vx "$self_dir" | paste -sd: -)
export PATH
pm2_bin=$(command -v pm2 || true)
if [ -z "$pm2_bin" ] || [ "$pm2_bin" = "$self_dir/pm2" ]; then
  printf 'pm2: no parent pm2 on PATH (install with: pnpm add -g pm2)\n' >&2
  exit 127
fi
exec env -u name "$pm2_bin" "$@"
EOF
            chmod +x .direnv/bin/pm2
            case ":$PATH:" in
              *":$PWD/.direnv/bin:"*) ;;
              *) export PATH="$PWD/.direnv/bin:$PATH" ;;
            esac
            if [ ! -d node_modules ] || [ package.json -nt node_modules ] || { [ -f pnpm-lock.yaml ] && [ pnpm-lock.yaml -nt node_modules ]; }; then
              pnpm install
            fi
          '';
        };
      });
}
