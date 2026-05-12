# Contributing

Thanks for helping improve OpenClaw Mini Chat.

## Local development

```bash
./install-local.sh
```

After installing, reload GNOME Shell or log out and back in. Then enable:

```bash
gnome-extensions enable openclaw-mini-chat@local
```

## Packaging

```bash
./pack.sh
```

Generated archives and compiled schema files are intentionally ignored. Rebuild them locally when needed.

## Pull requests

- Keep changes scoped to the extension behavior being changed.
- Update `README.md` when installation, usage, or packaging steps change.
- Run `glib-compile-schemas schemas` and `./pack.sh /tmp/openclaw-pack-check` before submitting packaging-related changes.

