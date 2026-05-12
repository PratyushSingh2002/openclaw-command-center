#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out_dir="${1:-${root_dir}/dist}"

mkdir -p "${out_dir}"

gnome-extensions pack "${root_dir}" \
  --force \
  --out-dir "${out_dir}" \
  --schema schemas/org.gnome.shell.extensions.openclaw-mini-chat.gschema.xml

echo "Created ${out_dir}/openclaw-mini-chat@local.shell-extension.zip"
