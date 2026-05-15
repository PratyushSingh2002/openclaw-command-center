// OpenClaw Mini Chat — extension.js v3
// Design: dark terminal aesthetic, inline command palette that appears/disappears
// based on input. Static command list is gone — it lives only in the popup.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const COMMANDS = [
    ['acp',        'Agent Control Protocol tools',        '⚙'],
    ['agent',      'Run one agent turn via the Gateway',  '🤖'],
    ['agents',     'Manage isolated agents',              '👥'],
    ['approvals',  'Manage exec approvals',               '✅'],
    ['backup',     'Create and verify backups',           '💾'],
    ['channels',   'Manage connected chat channels',      '📡'],
    ['clawbot',    'Legacy clawbot aliases',              '🦞'],
    ['completion', 'Generate shell completion',           '🔤'],
    ['config',     'Config get/set/unset/file/validate',  '🔧'],
    ['configure',  'Interactive configuration',           '🛠'],
    ['cron',       'Manage cron jobs',                    '⏱'],
    ['daemon',     'Gateway service alias',               '👻'],
    ['dashboard',  'Open the Control UI',                 '📊'],
    ['devices',    'Device pairing and tokens',           '📱'],
    ['directory',  'Lookup contacts and groups',          '📋'],
    ['dns',        'DNS discovery helpers',               '🌐'],
    ['docs',       'Search OpenClaw docs',                '📖'],
    ['doctor',     'Health checks and quick fixes',       '🩺'],
    ['gateway',    'Gateway control',                     '🚪'],
    ['health',     'Fetch gateway health',                '💚'],
    ['help',       'Show OpenClaw help',                  '❓'],
    ['hooks',      'Manage internal hooks',               '🪝'],
    ['logs',       'Tail gateway logs',                   '📜'],
    ['mcp',        'Manage MCP config and bridge',        '🔌'],
    ['memory',     'Search and inspect memory',           '🧠'],
    ['message',    'Send, read, and manage messages',     '💬'],
    ['models',     'Discover and configure models',       '🎯'],
    ['node',       'Manage node host service',            '🖥'],
    ['nodes',      'Manage gateway-owned nodes',          '🕸'],
    ['onboard',    'Run onboarding',                      '🚀'],
    ['pairing',    'Secure DM pairing',                   '🔒'],
    ['plugins',    'Manage plugins and extensions',       '🧩'],
    ['qr',         'Generate pairing QR/setup code',      '📷'],
    ['reset',      'Reset local config/state',            '🔄'],
    ['sandbox',    'Manage sandbox containers',           '📦'],
    ['secrets',    'Reload secrets runtime',              '🔑'],
    ['security',   'Security tools and audits',           '🛡'],
    ['sessions',   'List stored sessions',                '🗂'],
    ['setup',      'Initialize config and workspace',     '⚡'],
    ['skills',     'List and inspect skills',             '🎓'],
    ['status',     'Show channel health',                 '📶'],
    ['system',     'Events, heartbeat, presence',         '💓'],
    ['tasks',      'Inspect background tasks',            '📝'],
    ['tui',        'Open terminal UI command',            '🖱'],
    ['uninstall',  'Uninstall service and local data',    '🗑'],
    ['update',     'Update OpenClaw',                     '⬆'],
    ['webhooks',   'Webhook helpers',                     '🔗'],
];

const DEFAULT_OPENCLAW_COMMAND = '/home/pratyush/n/bin/openclaw';
const MAX_OUTPUT_CHARS = 3600;

// ── Utilities ────────────────────────────────────────────────────────────────

function stripAnsi(text) {
    return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
}

function shellSplit(text) {
    try {
        const [, argv] = GLib.shell_parse_argv(text);
        return argv;
    } catch (e) {
        throw new Error(`Could not parse command: ${e.message}`);
    }
}

function wrappedLabel(params) {
    const label = new St.Label(params);
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}

function timestamp() {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function summarizeForNotification(text) {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    if (!singleLine)
        return '';

    return singleLine.length > 140
        ? `${singleLine.slice(0, 137)}...`
        : singleLine;
}

// ── Indicator ─────────────────────────────────────────────────────────────────

const OpenClawIndicator = GObject.registerClass(
class OpenClawIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('OpenClaw Mini Chat'));

        this._extension = extension;
        this._settings  = extension.getSettings();
        this._messages  = [];
        this._currentProcess     = null;
        this._currentCancellable = null;
        this._inputHistory  = [];
        this._historyIndex  = -1;
        this._filterTimeout = null;
        this._selectedCommandIndex = -1;
        this._visibleCommands = [];

        this.add_child(new St.Label({
            text: 'OC',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'oc-panel-label',
        }));

        this._buildMenu();
    }

    destroy() {
        this._cancelRunning();
        if (this._filterTimeout) {
            GLib.source_remove(this._filterTimeout);
            this._filterTimeout = null;
        }
        super.destroy();
    }

    // ── Menu construction ───────────────────────────────────────────────────

    _buildMenu() {
        this.menu.box.add_style_class_name('oc-menu');

        const wrapper = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'oc-wrapper-item',
        });
        this.menu.addMenuItem(wrapper);

        const root = new St.BoxLayout({ vertical: true, style_class: 'oc-root' });
        wrapper.add_child(root);

        // Header
        root.add_child(this._buildHeader());

        // Chat history
        this._historyBox = new St.BoxLayout({
            vertical: true,
            style_class: 'oc-history',
            x_expand: true,
        });
        this._historyScroll = new St.ScrollView({
            style_class: 'oc-history-scroll',
            overlay_scrollbars: true,
            x_expand: true,
        });
        this._historyScroll.vscrollbar_policy = St.PolicyType.AUTOMATIC;
        this._historyScroll.hscrollbar_policy = St.PolicyType.NEVER;
        this._historyScroll.set_child(this._historyBox);
        root.add_child(this._historyScroll);

        // Command palette (hidden until '/' typed)
        this._paletteBox = new St.BoxLayout({
            vertical: true,
            style_class: 'oc-palette',
            x_expand: true,
            visible: false,
        });
        this._paletteHeader = new St.BoxLayout({
            style_class: 'oc-palette-header',
            x_expand: true,
        });
        this._paletteTitle = new St.Label({
            text: _('Commands'),
            style_class: 'oc-palette-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._paletteCount = new St.Label({
            text: '',
            style_class: 'oc-palette-count',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._paletteHeader.add_child(this._paletteTitle);
        this._paletteHeader.add_child(this._paletteCount);
        this._paletteBox.add_child(this._paletteHeader);

        this._paletteList = new St.BoxLayout({
            vertical: true,
            style_class: 'oc-palette-list',
        });
        const paletteScroll = new St.ScrollView({
            style_class: 'oc-palette-scroll',
            overlay_scrollbars: true,
            x_expand: true,
        });
        paletteScroll.vscrollbar_policy = St.PolicyType.AUTOMATIC;
        paletteScroll.hscrollbar_policy = St.PolicyType.NEVER;
        paletteScroll.set_child(this._paletteList);
        this._paletteScrollView = paletteScroll;
        this._paletteBox.add_child(paletteScroll);
        root.add_child(this._paletteBox);

        // Input row
        root.add_child(this._buildInputRow());

        // Initial message
        this._appendMessage('system', 'Type a message to chat, or type / to browse commands.');
    }

    _buildHeader() {
        const header = new St.BoxLayout({ style_class: 'oc-header', x_expand: true });

        // Blinking dot indicator
        this._dotActor = new St.Label({ text: '●', style_class: 'oc-dot oc-dot-idle' });
        header.add_child(this._dotActor);

        header.add_child(new St.Label({
            text: 'OpenClaw',
            style_class: 'oc-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._statusLabel = new St.Label({
            text: _('ready'),
            style_class: 'oc-status',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._statusLabel);

        const clearBtn = new St.Button({
            label: '⌫',
            can_focus: true,
            style_class: 'oc-icon-button',
            y_align: Clutter.ActorAlign.CENTER,
        });
        clearBtn.connect('clicked', () => {
            this._messages = [];
            this._appendMessage('system', 'History cleared.');
        });
        header.add_child(clearBtn);

        return header;
    }

    _buildInputRow() {
        const row = new St.BoxLayout({ style_class: 'oc-input-row', x_expand: true });

        // Prompt glyph
        row.add_child(new St.Label({
            text: '>',
            style_class: 'oc-prompt',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._entry = new St.Entry({
            hint_text: _('message or /command…'),
            can_focus: true,
            x_expand: true,
            track_hover: true,
            style_class: 'oc-entry',
        });

        this._entry.clutter_text.connect('activate', () => this._submit());

        this._entry.clutter_text.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();

            // ↑/↓ while palette visible = navigate commands
            if (this._paletteBox.visible) {
                if (key === Clutter.KEY_Up) {
                    this._movePaletteSelection(-1);
                    return Clutter.EVENT_STOP;
                }
                if (key === Clutter.KEY_Down) {
                    this._movePaletteSelection(1);
                    return Clutter.EVENT_STOP;
                }
                if (key === Clutter.KEY_Tab || key === Clutter.KEY_ISO_Left_Tab) {
                    this._acceptPaletteSelection();
                    return Clutter.EVENT_STOP;
                }
                if (key === Clutter.KEY_Escape) {
                    this._hidePalette();
                    return Clutter.EVENT_STOP;
                }
            } else {
                // Normal input history navigation
                if (key === Clutter.KEY_Up) {
                    this._navigateHistory(1);
                    return Clutter.EVENT_STOP;
                }
                if (key === Clutter.KEY_Down) {
                    this._navigateHistory(-1);
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._entry.clutter_text.connect('text-changed', () => {
            if (this._filterTimeout)
                GLib.source_remove(this._filterTimeout);
            this._filterTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                this._onInputChanged(this._entry.get_text());
                this._filterTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        });

        row.add_child(this._entry);

        this._sendButton = new St.Button({
            label: _('Send'),
            can_focus: true,
            style_class: 'oc-send-button',
        });
        this._sendButton.connect('clicked', () => this._submit());
        row.add_child(this._sendButton);

        this._stopButton = new St.Button({
            label: _('Stop'),
            can_focus: true,
            visible: false,
            style_class: 'oc-stop-button',
        });
        this._stopButton.connect('clicked', () => this._cancelRunning());
        row.add_child(this._stopButton);

        return row;
    }

    // ── Command Palette ──────────────────────────────────────────────────────

    _onInputChanged(text) {
        if (text.startsWith('/')) {
            const query = text.slice(1).toLowerCase();
            // Only show palette before a space (while still typing the command name)
            const hasArgs = query.includes(' ');
            if (!hasArgs) {
                const filtered = query.length === 0
                    ? COMMANDS
                    : COMMANDS.filter(([name, desc]) =>
                        name.startsWith(query) || desc.toLowerCase().includes(query)
                    );
                this._showPalette(filtered, query);
            } else {
                this._hidePalette();
            }
        } else {
            this._hidePalette();
        }
    }

    _showPalette(commands, query) {
        this._visibleCommands = commands;
        this._selectedCommandIndex = commands.length > 0 ? 0 : -1;
        this._paletteList.destroy_all_children();

        const count = commands.length;
        this._paletteCount.text = count === COMMANDS.length ? `${count}` : `${count} / ${COMMANDS.length}`;
        this._paletteTitle.text = query.length > 0 ? `/${query}…` : _('All commands');

        for (let i = 0; i < commands.length; i++) {
            const [name, desc, icon] = commands[i];
            this._paletteList.add_child(this._paletteRow(name, desc, icon, i));
        }

        this._paletteBox.visible = true;
        this._updatePaletteSelection();
        // Hide the history while palette is open for cleaner look
        this._historyScroll.visible = false;
    }

    _hidePalette() {
        this._paletteBox.visible = false;
        this._historyScroll.visible = true;
        this._visibleCommands = [];
        this._selectedCommandIndex = -1;
    }

    _paletteRow(name, desc, icon, index) {
        const btn = new St.Button({
            can_focus: true,
            style_class: 'oc-palette-row',
            x_expand: true,
            reactive: true,
        });
        btn._commandName = name;
        btn._commandIndex = index;

        const inner = new St.BoxLayout({ style_class: 'oc-palette-row-inner', x_expand: true });

        const iconLabel = new St.Label({
            text: icon || '›',
            style_class: 'oc-palette-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        inner.add_child(iconLabel);

        const textCol = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'oc-palette-text' });
        textCol.add_child(new St.Label({
            text: `/${name}`,
            style_class: 'oc-palette-cmd',
            x_expand: true,
        }));
        textCol.add_child(new St.Label({
            text: desc,
            style_class: 'oc-palette-desc',
            x_expand: true,
        }));
        inner.add_child(textCol);

        const tabHint = new St.Label({
            text: '↹',
            style_class: 'oc-palette-tab-hint',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        btn._tabHint = tabHint;
        inner.add_child(tabHint);

        btn.set_child(inner);

        btn.connect('enter-event', () => {
            this._selectedCommandIndex = index;
            this._updatePaletteSelection();
        });
        btn.connect('clicked', () => {
            this._fillCommand(name);
        });

        return btn;
    }

    _movePaletteSelection(delta) {
        if (this._visibleCommands.length === 0) return;
        this._selectedCommandIndex = Math.max(0, Math.min(
            this._visibleCommands.length - 1,
            this._selectedCommandIndex + delta
        ));
        this._updatePaletteSelection();
    }

    _updatePaletteSelection() {
        const children = this._paletteList.get_children();
        children.forEach((child, i) => {
            const selected = i === this._selectedCommandIndex;
            if (selected) {
                child.add_style_class_name('oc-palette-row-selected');
                if (child._tabHint) child._tabHint.visible = true;
            } else {
                child.remove_style_class_name('oc-palette-row-selected');
                if (child._tabHint) child._tabHint.visible = false;
            }
        });
    }

    _acceptPaletteSelection() {
        if (this._selectedCommandIndex >= 0 && this._visibleCommands[this._selectedCommandIndex]) {
            const [name] = this._visibleCommands[this._selectedCommandIndex];
            this._fillCommand(name);
        }
    }

    _fillCommand(name) {
        const newText = `/${name} `;
        this._entry.set_text(newText);
        this._entry.grab_key_focus();
        const len = newText.length;
        this._entry.clutter_text.set_selection(len, len);
        this._hidePalette();
    }

    // ── Busy state ───────────────────────────────────────────────────────────

    _setBusy(busy) {
        this._sendButton.reactive  = !busy;
        this._sendButton.can_focus = !busy;
        this._entry.reactive       = !busy;
        this._stopButton.visible   = busy;
        this._statusLabel.text     = busy ? _('running…') : _('ready');
        this._dotActor.style_class = busy ? 'oc-dot oc-dot-busy' : 'oc-dot oc-dot-idle';
    }

    // ── Submit ───────────────────────────────────────────────────────────────

    _submit() {
        const text = this._entry.get_text().trim();
        if (!text || this._currentProcess) return;

        let argv;
        try {
            argv = this._argvForText(text);
        } catch (error) {
            this._appendMessage('error', error.message);
            return;
        }

        if (this._inputHistory[this._inputHistory.length - 1] !== text) {
            this._inputHistory.push(text);
            if (this._inputHistory.length > 50)
                this._inputHistory.shift();
        }
        this._historyIndex = -1;
        this._hidePalette();
        this._entry.set_text('');
        this._appendMessage('user', text);
        this._run(argv);
    }

    _navigateHistory(direction) {
        if (this._inputHistory.length === 0) return;
        this._historyIndex = Math.max(-1, Math.min(
            this._inputHistory.length - 1,
            this._historyIndex + direction
        ));
        if (this._historyIndex === -1) {
            this._entry.set_text('');
        } else {
            const text = this._inputHistory[this._inputHistory.length - 1 - this._historyIndex];
            this._entry.set_text(text);
            const len = text.length;
            this._entry.clutter_text.set_selection(len, len);
        }
    }

    _argvForText(text) {
        const binary = this._settings.get_string('openclaw-command').trim() || DEFAULT_OPENCLAW_COMMAND;

        if (text.startsWith('/')) {
            const parts = shellSplit(text.slice(1));
            if (parts.length === 0)
                throw new Error('Type a command after /. Try /help or /status.');

            const command = parts[0];
            if (!COMMANDS.some(([name]) => name === command))
                this._appendMessage('system', `Note: /${command} is not in the local catalog — sending anyway.`);

            return [binary, '--no-color', ...parts];
        }

        const argv = [binary, '--no-color', 'agent', '--message', text];
        const recipient = this._settings.get_string('default-recipient').trim();
        if (recipient) {
            argv.push('--to', recipient);
        } else {
            const agentId = this._settings.get_string('default-agent-id').trim();
            if (agentId)
                argv.push('--agent', agentId);
        }
        if (this._settings.get_boolean('deliver-agent-replies'))
            argv.push('--deliver');

        return argv;
    }

    // ── Process management ───────────────────────────────────────────────────

    _run(argv) {
        this._setBusy(true);
        this._currentCancellable = new Gio.Cancellable();
        const commandSummary = argv.slice(2).join(' ');

        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        launcher.setenv('NO_COLOR', '1', true);

        try {
            this._currentProcess = launcher.spawnv(argv);
        } catch (error) {
            this._currentProcess     = null;
            this._currentCancellable = null;
            this._setBusy(false);
            this._appendMessage('error', `Could not start OpenClaw: ${error.message}`);
            this._notifyCommandResult(false, commandSummary, `Could not start OpenClaw: ${error.message}`);
            return;
        }

        this._currentProcess.communicate_utf8_async(null, this._currentCancellable, (proc, result) => {
            let stdout = '', stderr = '', ok = false;
            try {
                [, stdout, stderr] = proc.communicate_utf8_finish(result);
                ok = proc.get_successful();
            } catch (error) {
                stderr = error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
                    ? 'Command cancelled.' : error.message;
            }

            this._currentProcess     = null;
            this._currentCancellable = null;
            this._setBusy(false);

            if (!this._historyBox) return;

            const output = stripAnsi([stdout, stderr].filter(Boolean).join('\n'));
            this._appendMessage(ok ? 'reply' : 'error', output || (ok ? 'Done.' : 'OpenClaw exited without output.'));
            this._notifyCommandResult(ok, commandSummary, output || (ok ? 'Done.' : stderr || 'OpenClaw exited without output.'));
        });
    }

    _cancelRunning() {
        if (this._currentCancellable) {
            this._currentCancellable.cancel();
            this._currentCancellable = null;
        }
        if (this._currentProcess) {
            try { this._currentProcess.force_exit(); } catch (_) {}
            this._currentProcess = null;
        }
        this._setBusy(false);
    }

    // ── Messages ─────────────────────────────────────────────────────────────

    _appendMessage(kind, text) {
        const maxMessages = this._settings.get_uint('max-recent-replies');
        const trimmed = text.length > MAX_OUTPUT_CHARS
            ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (truncated)` : text;

        this._messages.push({ kind, text: trimmed, time: timestamp() });
        while (this._messages.length > Math.max(maxMessages, 2))
            this._messages.shift();

        this._renderMessages();
    }

    _renderMessages() {
        this._historyBox.destroy_all_children();

        for (const msg of this._messages) {
            const bubble = new St.BoxLayout({
                vertical: true,
                style_class: `oc-message oc-message-${msg.kind}`,
                x_expand: true,
            });

            // Role + time row
            const hdr = new St.BoxLayout({ style_class: 'oc-message-hdr', x_expand: true });

            const roleMap = { user: '▸ you', reply: '◂ openclaw', error: '✕ error', system: '· system' };
            hdr.add_child(new St.Label({
                text: roleMap[msg.kind] || msg.kind,
                style_class: 'oc-message-role',
                x_expand: true,
            }));

            if (msg.time) {
                hdr.add_child(new St.Label({
                    text: msg.time,
                    style_class: 'oc-message-time',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }

            const copyBtn = new St.Button({
                label: '⎘',
                can_focus: true,
                style_class: 'oc-copy-btn',
                y_align: Clutter.ActorAlign.CENTER,
            });
            copyBtn.connect('clicked', () => this._copyMessage(msg.text));
            hdr.add_child(copyBtn);
            bubble.add_child(hdr);

            bubble.add_child(wrappedLabel({
                text: msg.text,
                style_class: 'oc-message-text',
                x_expand: true,
            }));

            this._historyBox.add_child(bubble);
        }

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const adj = this._historyScroll?.vscroll?.adjustment;
            if (adj) adj.value = adj.upper - adj.page_size;
            return GLib.SOURCE_REMOVE;
        });
    }

    _copyMessage(text) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        const prev = this._statusLabel.text;
        this._statusLabel.text = _('copied ✓');
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1400, () => {
            if (!this._currentProcess)
                this._statusLabel.text = prev === _('copied ✓') ? _('ready') : prev;
            return GLib.SOURCE_REMOVE;
        });
    }

    _notifyCommandResult(ok, commandSummary, output) {
        const title = ok ? 'OpenClaw command completed' : 'OpenClaw command failed';
        const bodyParts = [];

        if (commandSummary)
            bodyParts.push(commandSummary);

        const summary = summarizeForNotification(output);
        if (summary)
            bodyParts.push(summary);

        Main.notify(title, bodyParts.join('\n'));
    }
});

export default class OpenClawMiniChatExtension extends Extension {
    enable() {
        this._indicator = new OpenClawIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
