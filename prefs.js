import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

// BUG FIX: lowercase 'shell' (was 'Shell') — caused silent import failure
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/shell/extensions/prefs.js';

export default class OpenClawMiniChatPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(560, 480);

        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('OpenClaw Mini Chat'),
            icon_name: 'utilities-terminal-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('OpenClaw'),
            description: _('Configure how the panel chat runs OpenClaw in the background.'),
        });
        page.add(group);

        const commandRow = new Adw.EntryRow({
            title: _('OpenClaw command'),
            text: settings.get_string('openclaw-command'),
        });
        // Save '' on clear — extension falls back to built-in default
        commandRow.connect('changed', row => {
            settings.set_string('openclaw-command', row.get_text().trim());
        });
        group.add(commandRow);

        const agentRow = new Adw.EntryRow({
            title: _('Default agent for plain chat'),
            text: settings.get_string('default-agent-id'),
        });
        agentRow.connect('changed', row => {
            settings.set_string('default-agent-id', row.get_text().trim());
        });
        group.add(agentRow);

        const recipientRow = new Adw.EntryRow({
            title: _('Default recipient for plain chat'),
            text: settings.get_string('default-recipient'),
        });
        recipientRow.connect('changed', row => {
            settings.set_string('default-recipient', row.get_text().trim());
        });
        group.add(recipientRow);

        const deliverRow = new Adw.SwitchRow({
            title: _('Deliver plain chat replies'),
            subtitle: _('Adds --deliver to plain text agent turns.'),
        });
        settings.bind('deliver-agent-replies', deliverRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(deliverRow);

        const maxRow = new Adw.SpinRow({
            title: _('Recent replies'),
            subtitle: _('Maximum messages shown in history (2–30).'),
            adjustment: new Gtk.Adjustment({
                lower: 2,
                upper: 30,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_uint('max-recent-replies'),
            }),
        });
        settings.bind('max-recent-replies', maxRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(maxRow);

        const notificationsRow = new Adw.SwitchRow({
            title: _('Command notifications'),
            subtitle: _('Show a GNOME notification when a command completes or fails.'),
        });
        settings.bind('notify-command-results', notificationsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(notificationsRow);

        const tips = new Adw.PreferencesGroup({ title: _('Keyboard shortcuts') });
        page.add(tips);

        tips.add(new Adw.ActionRow({
            title: _('/ command palette'),
            subtitle: _('Type / → filter live · ↑↓ navigate · Tab accept · Esc dismiss'),
        }));
        tips.add(new Adw.ActionRow({
            title: _('Input history'),
            subtitle: _('↑/↓ when palette is closed'),
        }));
    }
}
