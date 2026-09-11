#!/bin/sh
# Run a reviewed local file; never pipe a remote script into a shell.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)' 2>/dev/null; then
  exec node "$project_root/setup/cli.mjs" "$@"
fi
if [ "$(uname -s)" != Darwin ]; then
  echo 'Linux: install a supported Node.js and run node setup/cli.mjs install.' >&2; exit 1
fi
case "$(uname -m)" in arm64) arch=arm64;; x86_64) arch=x64;; *) echo 'Unsupported architecture' >&2; exit 1;; esac
version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$project_root/setup/runtime.json")
checksum=$(sed -n "s/.*\"darwin-$arch\": \"\([^\"]*\)\".*/\1/p" "$project_root/setup/runtime.json")
runtime_dir="$project_root/.runtime"
mkdir -p "$runtime_dir"
runtime="$runtime_dir/node-v$version-darwin-$arch"
if [ ! -x "$runtime/bin/node" ]; then
  stage=$(mktemp -d "$runtime_dir/download.XXXXXX")
  trap 'rm -rf -- "$stage"' EXIT HUP INT TERM
  archive="node-v$version-darwin-$arch.tar.gz"
  curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$version/$archive" -o "$stage/$archive"
  actual=$(shasum -a 256 "$stage/$archive" | cut -d ' ' -f 1)
  [ "$actual" = "$checksum" ] || { echo 'Node download checksum mismatch' >&2; exit 1; }
  tar -xzf "$stage/$archive" -C "$stage"
  mv "$stage/node-v$version-darwin-$arch" "$runtime"
  rm -rf -- "$stage"
  trap - EXIT HUP INT TERM
fi
export PATH="$runtime/bin:$PATH"
exec "$runtime/bin/node" "$project_root/setup/cli.mjs" "$@"
