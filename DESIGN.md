# Design Notes

## Architecture

The project is intentionally small but separated into focused modules:

- `extension.js`: GNOME Shell entry point, panel button, menu actions, lifecycle, and orchestration.
- `src/chatDialog.js`: modal mini-chat UI built with `St`/`Clutter` and `ModalDialog`.
- `src/transport.js`: HTTP and command transports with a shared payload contract and defensive response parsing.
- `src/slashCommands.js`: local slash-command catalog loading and autocomplete filtering.
- `src/storage.js`: lightweight local JSON persistence for message history.
- `prefs.js`: GTK4/Libadwaita preferences window backed by GSettings.

## UI decision

The request asked for a popup-based mini chat UI, but GNOME Shell extensions are awkward for a true multiline editor inside a panel dropdown. Instead of faking that, the extension uses a top-bar button plus a shell modal dialog:

- the panel menu still exists for quick actions like opening chat, clearing history, and opening preferences;
- the actual chat surface is modal, scrollable, and multiline, which is much more practical inside GNOME Shell.

This is the main architectural compromise, and it is deliberate.

## Slash commands

Slash commands are handled in two layers:

1. Transport layer:
   Any input beginning with `/` is marked as a slash-command request and forwarded unchanged to the configured backend.
2. UX layer:
   The extension also loads a local slash-command catalog for autocomplete and lightweight help text.

This keeps the feature useful even when exact OpenClaw command discovery is impossible from the shell extension.

## Persistence

History is persisted locally as JSON under the user data directory:

`~/.local/share/openclaw-panel@pratyush.dev/history.json`

Only lightweight message objects are stored:

```json
{"role":"user","content":"...","timestamp":"..."}
```

The history limit is configurable in preferences.

## Transport realism

The extension does not assume a hidden OpenClaw protocol. Instead it exposes a stable, documented contract:

- HTTP mode sends one JSON payload to a configured endpoint.
- Command mode executes a configured command string and writes the same JSON payload to stdin.

Responses may be plain text or JSON with common text-bearing fields. If a backend needs custom behavior, the clean place to adapt that is the HTTP service or command script, not the shell UI.

## Limitations

- No dynamic discovery of OpenClaw slash commands.
- No streaming token-by-token rendering.
- No background daemon management; the extension is a client, not a process supervisor.
- No assumption that arbitrary local commands are safe or well-behaved. Command mode is intentionally explicit and user-configured.
