import Gio from 'gi://Gio';

import {expandUserPath} from './storage.js';

const decoder = new TextDecoder();

function normalizeEntry(entry) {
    if (typeof entry === 'string') {
        const name = entry.startsWith('/') ? entry : `/${entry}`;
        return {
            name,
            description: '',
            usage: name,
        };
    }

    if (!entry || typeof entry !== 'object' || !entry.name)
        return null;

    const name = entry.name.startsWith('/') ? entry.name : `/${entry.name}`;
    return {
        name,
        description: entry.description ?? '',
        usage: entry.usage ?? name,
    };
}

function parsePlainText(contents) {
    return contents
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !line.startsWith('#'))
        .map(line => {
            const parts = line.split(/\s+-\s+/, 2);
            const name = parts[0].startsWith('/') ? parts[0] : `/${parts[0]}`;
            return {
                name,
                description: parts[1] ?? '',
                usage: name,
            };
        });
}

function loadFile(path) {
    const file = Gio.File.new_for_path(path);
    const [success, contents] = file.load_contents(null);
    if (!success)
        throw new Error(`Unable to read ${path}`);

    return decoder.decode(contents);
}

export function getDefaultSlashCatalogPath(extensionPath) {
    return `${extensionPath}/config/slash-commands.json`;
}

export function loadSlashCatalog(catalogPath, extensionPath) {
    const resolvedPath = expandUserPath(
        catalogPath && catalogPath.trim() ? catalogPath.trim() : getDefaultSlashCatalogPath(extensionPath)
    );

    try {
        const contents = loadFile(resolvedPath);
        let parsed;

        if (resolvedPath.endsWith('.json')) {
            parsed = JSON.parse(contents);

            if (Array.isArray(parsed))
                return parsed.map(normalizeEntry).filter(Boolean);

            if (parsed && typeof parsed === 'object') {
                return Object.entries(parsed).map(([name, description]) =>
                    normalizeEntry({name, description})
                ).filter(Boolean);
            }
        }

        return parsePlainText(contents);
    } catch (error) {
        console.error(`[OpenClaw Panel] Failed to load slash catalog ${resolvedPath}: ${error}`);
        return [];
    }
}

export function getSlashSuggestions(inputText, catalog, limit = 5) {
    const trimmed = inputText.trim();
    if (!trimmed.startsWith('/'))
        return [];

    const prefix = trimmed.split(/\s+/, 1)[0].toLowerCase();
    const ordered = catalog
        .filter(entry => entry.name.toLowerCase().startsWith(prefix) || prefix === '/')
        .sort((a, b) => a.name.localeCompare(b.name));

    return ordered.slice(0, limit);
}
