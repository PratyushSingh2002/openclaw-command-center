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
    ['acp', 'Agent Control Protocol tools'],
    ['agent', 'Run one agent turn via the Gateway'],
    ['agents', 'Manage isolated agents'],
    ['approvals', 'Manage exec approvals'],
    ['backup', 'Create and verify backups'],
    ['channels', 'Manage connected chat channels'],
    ['clawbot', 'Legacy clawbot aliases'],
    ['completion', 'Generate shell completion'],
    ['config', 'Config get/set/unset/file/validate'],
    ['configure', 'Interactive configuration'],
    ['cron', 'Manage cron jobs'],
    ['daemon', 'Gateway service alias'],
    ['dashboard', 'Open the Control UI'],
    ['devices', 'Device pairing and tokens'],
    ['directory', 'Lookup contacts and groups'],
    ['dns', 'DNS discovery helpers'],
    ['docs', 'Search OpenClaw docs'],
    ['doctor', 'Health checks and quick fixes'],
    ['gateway', 'Gateway control'],
    ['health', 'Fetch gateway health'],
    ['help', 'Show OpenClaw help'],
    ['hooks', 'Manage internal hooks'],
    ['logs', 'Tail gateway logs'],
    ['mcp', 'Manage MCP config and bridge'],
    ['memory', 'Search and inspect memory'],
    ['message', 'Send, read, and manage messages'],
    ['models', 'Discover and configure models'],
    ['node', 'Manage node host service'],
    ['nodes', 'Manage gateway-owned nodes'],
    ['onboard', 'Run onboarding'],
    ['pairing', 'Secure DM pairing'],
    ['plugins', 'Manage plugins and extensions'],
    ['qr', 'Generate pairing QR/setup code'],
    ['reset', 'Reset local config/state'],
    ['sandbox', 'Manage sandbox containers'],
    ['secrets', 'Reload secrets runtime'],
    ['security', 'Security tools and audits'],
    ['sessions', 'List stored sessions'],
    ['setup', 'Initialize config and workspace'],
    ['skills', 'List and inspect skills'],
    ['status', 'Show channel health'],
    ['system', 'Events, heartbeat, presence'],
    ['tasks', 'Inspect background tasks'],
    ['tui', 'Open terminal UI command'],
    ['uninstall', 'Uninstall service and local data'],
    ['update', 'Update OpenClaw'],
    ['webhooks', 'Webhook helpers'],
];

const DEFAULT_OPENCLAW_COMMAND = '/home/pratyush/n/bin/openclaw';
const MAX_OUTPUT_CHARS = 3600;

function stripAnsi(text) {
    return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
}

function shellSplit(text) {
    try {
        const [, argv] = GLib.shell_parse_argv(text);
        return argv;
    } catch (error) {
        throw new Error(`Could not parse command: ${error.message}`);
    }
}

function wrappedLabel(params) {
    const label = new St.Label(params);
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}

const OpenClawIndicator = GObject.registerClass(
class OpenClawIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('OpenClaw Mini Chat'));

        this._extension = extension;
        this._settings = extension.getSettings();
        this._messages = [];
        this._currentProcess = null;
        this._currentCancellable = null;

        this.add_child(new St.Label({
            text: 'OC',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'openclaw-panel-label',
        }));

        this._buildMenu();
    }

    destroy() {
        this._cancelRunning();
        super.destroy();
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('openclaw-menu');

        const wrapper = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'openclaw-wrapper-item',
        });
        this.menu.addMenuItem(wrapper);

        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'openclaw-root',
        });
        wrapper.add_child(root);

        const header = new St.BoxLayout({
            style_class: 'openclaw-header',
            x_expand: true,
        });
        header.add_child(new St.Label({
            text: _('OpenClaw'),
            style_class: 'openclaw-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._statusLabel = new St.Label({
            text: _('Ready'),
            style_class: 'openclaw-status',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._statusLabel);
        root.add_child(header);

        this._historyBox = new St.BoxLayout({
            vertical: true,
            style_class: 'openclaw-history',
            x_expand: true,
        });
        const historyScroll = new St.ScrollView({
            style_class: 'openclaw-scroll',
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        historyScroll.set_child(this._historyBox);
        root.add_child(historyScroll);

        const entryRow = new St.BoxLayout({
            style_class: 'openclaw-input-row',
            x_expand: true,
        });
        this._entry = new St.Entry({
            hint_text: _('Ask OpenClaw or type /status'),
            can_focus: true,
            x_expand: true,
            track_hover: true,
            style_class: 'openclaw-entry',
        });
        this._entry.clutter_text.connect('activate', () => this._submit());
        entryRow.add_child(this._entry);

        this._sendButton = new St.Button({
            label: _('Send'),
            can_focus: true,
            style_class: 'openclaw-send-button',
        });
        this._sendButton.connect('clicked', () => this._submit());
        entryRow.add_child(this._sendButton);

        this._stopButton = new St.Button({
            label: _('Stop'),
            can_focus: true,
            visible: false,
            style_class: 'openclaw-stop-button',
        });
        this._stopButton.connect('clicked', () => this._cancelRunning());
        entryRow.add_child(this._stopButton);
        root.add_child(entryRow);

        root.add_child(new St.Label({
            text: _('/ commands'),
            style_class: 'openclaw-command-heading',
        }));

        const commandGrid = new St.BoxLayout({
            vertical: true,
            style_class: 'openclaw-command-grid',
        });
        for (const [command, description] of COMMANDS)
            commandGrid.add_child(this._commandButton(command, description));

        const commandScroll = new St.ScrollView({
            style_class: 'openclaw-command-scroll',
            overlay_scrollbars: true,
            x_expand: true,
        });
        commandScroll.set_child(commandGrid);
        root.add_child(commandScroll);

        this._appendMessage('system', 'Type a message to run `openclaw agent --agent main --message`, or use any OpenClaw command as `/command args`.');
    }

    _commandButton(command, description) {
        const button = new St.Button({
            can_focus: true,
            style_class: 'openclaw-command-button',
            x_expand: true,
        });
        const box = new St.BoxLayout({vertical: true, x_expand: true});
        box.add_child(wrappedLabel({
            text: `/${command}`,
            style_class: 'openclaw-command-name',
            x_expand: true,
        }));
        box.add_child(wrappedLabel({
            text: description,
            style_class: 'openclaw-command-description',
            x_expand: true,
        }));
        button.set_child(box);
        button.connect('clicked', () => {
            this._entry.set_text(`/${command} `);
            this._entry.grab_key_focus();
            this._entry.clutter_text.set_cursor_position(this._entry.get_text().length);
        });
        return button;
    }

    _setBusy(busy) {
        this._sendButton.reactive = !busy;
        this._sendButton.can_focus = !busy;
        this._stopButton.visible = busy;
        this._statusLabel.text = busy ? _('Running') : _('Ready');
    }

    _submit() {
        const text = this._entry.get_text().trim();
        if (!text || this._currentProcess)
            return;

        let argv;
        try {
            argv = this._argvForText(text);
        } catch (error) {
            this._appendMessage('error', error.message);
            return;
        }

        this._entry.set_text('');
        this._appendMessage('user', text);
        this._run(argv);
    }

    _argvForText(text) {
        const binary = this._settings.get_string('openclaw-command').trim() || DEFAULT_OPENCLAW_COMMAND;
        if (text.startsWith('/')) {
            const parts = shellSplit(text.slice(1));
            if (parts.length === 0)
                throw new Error('Type a command after /. Try /help or /status.');

            const command = parts[0];
            if (!COMMANDS.some(([name]) => name === command))
                throw new Error(`Unknown OpenClaw command /${command}. Pick one from the command list.`);

            return [binary, '--no-color', ...parts];
        }

        const argv = [binary, '--no-color', 'agent', '--message', text];
        const recipient = this._settings.get_string('default-recipient').trim();
        if (recipient)
            argv.push('--to', recipient);
        else {
            const agentId = this._settings.get_string('default-agent-id').trim();
            if (agentId)
                argv.push('--agent', agentId);
        }
        if (this._settings.get_boolean('deliver-agent-replies'))
            argv.push('--deliver');

        return argv;
    }

    _run(argv) {
        this._setBusy(true);
        this._currentCancellable = new Gio.Cancellable();

        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        launcher.setenv('NO_COLOR', '1', true);

        try {
            this._currentProcess = launcher.spawnv(argv);
        } catch (error) {
            this._currentProcess = null;
            this._currentCancellable = null;
            this._setBusy(false);
            this._appendMessage('error', `Could not start OpenClaw: ${error.message}`);
            return;
        }

        this._currentProcess.communicate_utf8_async(null, this._currentCancellable, (proc, result) => {
            let stdout = '';
            let stderr = '';
            let ok = false;

            try {
                [, stdout, stderr] = proc.communicate_utf8_finish(result);
                ok = proc.get_successful();
            } catch (error) {
                stderr = error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
                    ? 'Command cancelled.'
                    : error.message;
            }

            const output = stripAnsi([stdout, stderr].filter(Boolean).join('\n'));
            this._appendMessage(ok ? 'reply' : 'error', output || (ok ? 'Done.' : 'OpenClaw exited without output.'));
            this._currentProcess = null;
            this._currentCancellable = null;
            this._setBusy(false);
        });
    }

    _cancelRunning() {
        if (this._currentCancellable)
            this._currentCancellable.cancel();
        if (this._currentProcess) {
            try {
                this._currentProcess.force_exit();
            } catch (error) {
                logError(error, 'Failed to stop OpenClaw process');
            }
        }
    }

    _appendMessage(kind, text) {
        const maxMessages = this._settings.get_uint('max-recent-replies');
        const trimmed = text.length > MAX_OUTPUT_CHARS
            ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n...`
            : text;

        this._messages.push({kind, text: trimmed});
        while (this._messages.length > Math.max(maxMessages, 2))
            this._messages.shift();

        this._renderMessages();
    }

    _renderMessages() {
        this._historyBox.destroy_all_children();

        for (const message of this._messages) {
            const bubble = new St.BoxLayout({
                vertical: true,
                style_class: `openclaw-message openclaw-message-${message.kind}`,
                x_expand: true,
            });

            const header = new St.BoxLayout({
                style_class: 'openclaw-message-header',
                x_expand: true,
            });
            header.add_child(wrappedLabel({
                text: message.kind === 'user'
                    ? _('You')
                    : message.kind === 'error'
                        ? _('OpenClaw error')
                        : _('OpenClaw'),
                style_class: 'openclaw-message-role',
                x_expand: true,
            }));
            const copyButton = new St.Button({
                label: _('Copy'),
                can_focus: true,
                style_class: 'openclaw-copy-button',
            });
            copyButton.connect('clicked', () => this._copyMessage(message.text));
            header.add_child(copyButton);
            bubble.add_child(header);

            bubble.add_child(wrappedLabel({
                text: message.text,
                style_class: 'openclaw-message-text',
                x_expand: true,
            }));
            this._historyBox.add_child(bubble);
        }
    }

    _copyMessage(text) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        this._statusLabel.text = _('Copied');
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            if (!this._currentProcess)
                this._statusLabel.text = _('Ready');
            return GLib.SOURCE_REMOVE;
        });
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
