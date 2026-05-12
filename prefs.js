import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const DEFAULT_OPENCLAW_COMMAND = '/home/pratyush/n/bin/openclaw';

export default class OpenClawMiniChatPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(560, 420);

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
        commandRow.connect('changed', row => {
            settings.set_string('openclaw-command', row.get_text().trim() || DEFAULT_OPENCLAW_COMMAND);
        });
        group.add(commandRow);

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
            subtitle: _('Adds --deliver to plain text agent turns. Slash commands are run exactly as typed.'),
        });
        settings.bind('deliver-agent-replies', deliverRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(deliverRow);

        const maxRow = new Adw.SpinRow({
            title: _('Recent replies'),
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
    }
}
