# OpenClaw Mini Chat


![openclaw extension](<Screenshot From 2026-05-14 17-59-45.png>)

GNOME Shell extension for interacting with OpenClaw from the top panel without opening a terminal.

## Features

- Adds an `OC` panel button with a dropdown mini chat.
- Sends plain text as `openclaw --no-color agent --message "..." --agent main` by default.
- Runs OpenClaw slash commands directly, for example `/status`, `/doctor`, or `/message send --target +15555550123 --message "Hi"`.
- Shows recent replies in the dropdown and includes all top-level commands from `openclaw --help`.
- Includes preferences for the OpenClaw executable, default plain-chat agent, optional recipient, `--deliver`, and history length.

## Install locally

```bash
cd ~/Desktop/openclaw-command-center
./install-local.sh
gnome-extensions enable openclaw-mini-chat@local
```

On Wayland, log out and back in after installing or updating. On X11, `Alt`+`F2`, then `r`, then Enter usually reloads GNOME Shell.

## Package

```bash
cd ~/Desktop/openclaw-command-center
./pack.sh
```

The archive is written to `dist/openclaw-mini-chat@local.shell-extension.zip`.
