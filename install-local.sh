#!/usr/bin/env bash
set -euo pipefail

uuid="openclaw-mini-chat@local"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target_dir="${HOME}/.local/share/gnome-shell/extensions/${uuid}"

mkdir -p "${target_dir}"
rsync -a --delete "${root_dir}/" "${target_dir}/" \
  --include '/extension.js' \
  --include '/metadata.json' \
  --include '/prefs.js' \
  --include '/stylesheet.css' \
  --include '/schemas/' \
  --include '/schemas/org.gnome.shell.extensions.openclaw-mini-chat.gschema.xml' \
  --exclude '*'

glib-compile-schemas "${target_dir}/schemas"

echo "Installed ${uuid} into ${target_dir}"
echo "Enable with: gnome-extensions enable ${uuid}"
