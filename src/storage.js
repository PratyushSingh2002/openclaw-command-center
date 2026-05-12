import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function ensureDirectory(path) {
    const file = Gio.File.new_for_path(path);
    try {
        file.make_directory_with_parents(null);
    } catch (error) {
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw error;
    }
}

function loadTextFile(path) {
    const file = Gio.File.new_for_path(path);
    const [success, contents] = file.load_contents(null);
    if (!success)
        throw new Error(`Unable to read ${path}`);

    return decoder.decode(contents);
}

function writeTextFile(path, contents) {
    const file = Gio.File.new_for_path(path);
    file.replace_contents(
        encoder.encode(contents),
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
    );
}

export function expandUserPath(inputPath) {
    if (!inputPath)
        return '';

    if (inputPath === '~')
        return GLib.get_home_dir();

    if (inputPath.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), inputPath.slice(2)]);

    return inputPath;
}

export class HistoryStore {
    constructor(uuid) {
        this._directory = GLib.build_filenamev([GLib.get_user_data_dir(), uuid]);
        this._path = GLib.build_filenamev([this._directory, 'history.json']);
    }

    get path() {
        return this._path;
    }

    load() {
        ensureDirectory(this._directory);

        const file = Gio.File.new_for_path(this._path);
        if (!file.query_exists(null))
            return [];

        try {
            const parsed = JSON.parse(loadTextFile(this._path));
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error(`[OpenClaw Panel] Failed to parse history file: ${error}`);
            return [];
        }
    }

    save(history) {
        ensureDirectory(this._directory);
        writeTextFile(this._path, JSON.stringify(history, null, 2));
    }

    clear() {
        this.save([]);
    }
}
