import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

function formatTimestamp(timestamp) {
    if (!timestamp)
        return '';

    try {
        return new Date(timestamp).toLocaleTimeString();
    } catch (_error) {
        return '';
    }
}

function setWrapping(label) {
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
}

function destroyChildren(actor) {
    for (const child of actor.get_children())
        child.destroy();
}

export class OpenClawChatDialog extends ModalDialog.ModalDialog {
    constructor(controller) {
        super({
            destroyOnClose: false,
            shellReactive: false,
            shouldFadeIn: true,
            shouldFadeOut: true,
            styleClass: 'openclaw-chat-dialog',
        });

        this._controller = controller;
        this._history = [];

        this._buildUi();
    }

    _buildUi() {
        this.contentLayout.set_style('width: 640px; height: 720px;');

        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'openclaw-chat-root',
            x_expand: true,
            y_expand: true,
        });
        this.contentLayout.add_child(root);

        const title = new St.Label({
            text: 'OpenClaw',
            style_class: 'openclaw-dialog-title',
            x_align: Clutter.ActorAlign.START,
        });
        root.add_child(title);

        const subtitle = new St.Label({
            text: 'Mini chat UI for an OpenClaw-compatible backend',
            style_class: 'openclaw-dialog-subtitle',
            x_align: Clutter.ActorAlign.START,
        });
        root.add_child(subtitle);

        this._statusLabel = new St.Label({
            text: 'Ready',
            style_class: 'openclaw-status-label',
            x_align: Clutter.ActorAlign.START,
        });
        root.add_child(this._statusLabel);

        this._historyScroll = new St.ScrollView({
            style_class: 'openclaw-history-scroll',
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        this._messageList = new St.BoxLayout({
            vertical: true,
            style_class: 'openclaw-message-list',
            x_expand: true,
            y_expand: true,
        });
        this._historyScroll.set_child(this._messageList);
        root.add_child(this._historyScroll);

        this._suggestionsRow = new St.BoxLayout({
            style_class: 'openclaw-suggestions-row',
            x_expand: true,
            visible: false,
        });
        root.add_child(this._suggestionsRow);

        const inputFrame = new St.BoxLayout({
            vertical: true,
            style_class: 'openclaw-input-frame',
            x_expand: true,
        });
        root.add_child(inputFrame);

        const inputHint = new St.Label({
            text: 'Enter inserts a newline. Press Ctrl+Enter to send. Slash commands are forwarded unchanged.',
            style_class: 'openclaw-input-hint',
            x_align: Clutter.ActorAlign.START,
        });
        inputFrame.add_child(inputHint);

        const inputShell = new St.BoxLayout({
            vertical: true,
            style_class: 'openclaw-input-shell',
            x_expand: true,
            y_expand: true,
            reactive: true,
            can_focus: true,
        });
        inputFrame.add_child(inputShell);

        this._inputActor = new Clutter.Text({
            editable: true,
            line_wrap: true,
            line_wrap_mode: Pango.WrapMode.WORD_CHAR,
            reactive: true,
            selectable: true,
            single_line_mode: false,
            text: '',
            x_expand: true,
            y_expand: true,
        });
        inputShell.add_child(this._inputActor);

        inputShell.connect('button-press-event', () => {
            global.stage.set_key_focus(this._inputActor);
            return Clutter.EVENT_PROPAGATE;
        });

        this._inputActor.connect('text-changed', () => {
            this._controller.onDraftChanged(this._inputActor.get_text());
            this.updateSuggestions(this._controller.getSlashSuggestions(this._inputActor.get_text()));
        });

        this._inputActor.connect('key-press-event', (_actor, event) => {
            const keyval = event.get_key_symbol();
            const state = event.get_state();
            const ctrlPressed = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

            if (ctrlPressed && (keyval === Clutter.KEY_Return || keyval === Clutter.KEY_KP_Enter)) {
                this._sendCurrentInput();
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });

        const actionRow = new St.BoxLayout({
            style_class: 'openclaw-action-row',
            x_expand: true,
        });
        root.add_child(actionRow);

        this._clearButton = new St.Button({
            label: 'Clear Input',
            style_class: 'button',
            x_expand: false,
        });
        this._clearButton.connect('clicked', () => this.setInputText(''));
        actionRow.add_child(this._clearButton);

        this._sendButton = new St.Button({
            label: 'Send',
            style_class: 'button openclaw-send-button',
            x_expand: false,
        });
        this._sendButton.connect('clicked', () => this._sendCurrentInput());
        actionRow.add_child(this._sendButton);

        this.addButton({
            label: 'Preferences',
            action: () => this._controller.openPreferences(),
        });
        this.addButton({
            label: 'Close',
            key: Clutter.KEY_Escape,
            isDefault: true,
            action: () => this.close(),
        });
    }

    openWithFocus() {
        this.open();
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            global.stage.set_key_focus(this._inputActor);
            return GLib.SOURCE_REMOVE;
        });
    }

    setHistory(history) {
        this._history = [...history];
        this._renderHistory();
    }

    appendMessage(message) {
        this._history.push(message);
        this._addMessageBubble(message);
        this._scrollHistoryToBottom();
    }

    setStatus(text, kind = 'info') {
        this._statusLabel.text = text;
        this._statusLabel.remove_style_class_name('openclaw-status-error');
        this._statusLabel.remove_style_class_name('openclaw-status-success');
        this._statusLabel.remove_style_class_name('openclaw-status-busy');

        if (kind === 'error')
            this._statusLabel.add_style_class_name('openclaw-status-error');
        else if (kind === 'success')
            this._statusLabel.add_style_class_name('openclaw-status-success');
        else if (kind === 'busy')
            this._statusLabel.add_style_class_name('openclaw-status-busy');
    }

    setInputText(text) {
        this._inputActor.set_text(text);
        global.stage.set_key_focus(this._inputActor);
        this.updateSuggestions(this._controller.getSlashSuggestions(text));
    }

    getInputText() {
        return this._inputActor.get_text();
    }

    setSending(isSending) {
        this._sendButton.reactive = !isSending;
        this._clearButton.reactive = !isSending;
        this._inputActor.editable = !isSending;
    }

    updateSuggestions(suggestions) {
        destroyChildren(this._suggestionsRow);

        if (!suggestions.length) {
            this._suggestionsRow.hide();
            return;
        }

        for (const entry of suggestions) {
            const button = new St.Button({
                label: entry.name,
                style_class: 'button openclaw-suggestion-button',
            });
            button.connect('clicked', () => {
                const suffix = entry.usage && entry.usage !== entry.name ? ` ${entry.usage.slice(entry.name.length).trim()}` : '';
                this.setInputText(`${entry.name}${suffix}`.trimEnd());
            });

            this._suggestionsRow.add_child(button);
        }

        this._suggestionsRow.show();
    }

    _renderHistory() {
        destroyChildren(this._messageList);

        if (this._history.length === 0) {
            const empty = new St.Label({
                text: 'No local messages yet. Start with a prompt or a slash command.',
                style_class: 'openclaw-empty-history',
                x_align: Clutter.ActorAlign.START,
            });
            setWrapping(empty);
            this._messageList.add_child(empty);
            return;
        }

        for (const message of this._history)
            this._addMessageBubble(message);

        this._scrollHistoryToBottom();
    }

    _addMessageBubble(message) {
        const bubble = new St.BoxLayout({
            vertical: true,
            style_class: `openclaw-message-bubble openclaw-role-${message.role ?? 'assistant'}`,
            x_expand: true,
        });

        const header = new St.Label({
            text: `${message.role ?? 'assistant'} ${formatTimestamp(message.timestamp)}`.trim(),
            style_class: 'openclaw-message-header',
            x_align: Clutter.ActorAlign.START,
        });
        bubble.add_child(header);

        const body = new St.Label({
            text: message.content ?? '',
            style_class: 'openclaw-message-body',
            x_align: Clutter.ActorAlign.START,
        });
        setWrapping(body);
        bubble.add_child(body);

        this._messageList.add_child(bubble);
    }

    _scrollHistoryToBottom() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const adjustment = this._historyScroll.get_vscroll_bar().get_adjustment();
            adjustment.value = Math.max(0, adjustment.upper - adjustment.page_size);
            return GLib.SOURCE_REMOVE;
        });
    }

    _sendCurrentInput() {
        const text = this.getInputText().trim();
        if (!text)
            return;

        this._controller.onSendRequested(text);
    }
}
