import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

function parseResponseText(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed)
        return '';

    try {
        const parsed = JSON.parse(trimmed);
        return extractResponseText(parsed) ?? trimmed;
    } catch (_error) {
        return trimmed;
    }
}

function extractResponseText(value) {
    if (typeof value === 'string')
        return value;

    if (!value || typeof value !== 'object')
        return null;

    const directKeys = ['text', 'message', 'response', 'output', 'content', 'result'];
    for (const key of directKeys) {
        if (typeof value[key] === 'string' && value[key].trim())
            return value[key];
    }

    if (Array.isArray(value.choices) && value.choices.length > 0) {
        const choice = value.choices[0];
        if (choice?.message?.content)
            return String(choice.message.content);
        if (typeof choice?.text === 'string')
            return choice.text;
    }

    if (Array.isArray(value.messages) && value.messages.length > 0) {
        const lastAssistant = [...value.messages].reverse().find(item => item?.role === 'assistant');
        if (lastAssistant?.content)
            return String(lastAssistant.content);
    }

    return null;
}

function communicateUtf8Async(proc, stdinData) {
    return new Promise((resolve, reject) => {
        proc.communicate_utf8_async(stdinData, null, (self, result) => {
            try {
                const [, stdout, stderr] = self.communicate_utf8_finish(result);
                resolve({stdout: stdout ?? '', stderr: stderr ?? '', successful: self.get_successful()});
            } catch (error) {
                reject(error);
            }
        });
    });
}

function sendAndReadAsync(session, message) {
    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
            try {
                resolve(session.send_and_read_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export class OpenClawTransport {
    constructor(settings) {
        this._settings = settings;
        this._httpSession = new Soup.Session();
    }

    describeReadiness() {
        const mode = this._settings.get_string('backend-mode');
        if (mode === 'http') {
            const url = this._settings.get_string('http-endpoint-url').trim();
            return url ? `HTTP ready: ${url}` : 'HTTP mode needs an endpoint URL';
        }

        const command = this._settings.get_string('command-path').trim();
        return command ? `Command ready: ${command}` : 'Command mode needs a command or script path';
    }

    async sendMessage(message, history) {
        const isSlashCommand = message.trimStart().startsWith('/');
        const payload = {
            message,
            input: message,
            isSlashCommand,
            history,
            timestamp: new Date().toISOString(),
            client: 'gnome-shell-extension',
        };

        const mode = this._settings.get_string('backend-mode');
        if (mode === 'command')
            return this._sendCommand(payload);

        return this._sendHttp(payload);
    }

    async _sendHttp(payload) {
        const url = this._settings.get_string('http-endpoint-url').trim();
        if (!url)
            throw new Error('HTTP endpoint URL is empty.');

        const requestBody = JSON.stringify(payload);
        const message = Soup.Message.new('POST', url);
        if (!message)
            throw new Error(`Could not create HTTP request for ${url}`);

        message.request_headers.append('Content-Type', 'application/json');

        const token = this._settings.get_string('http-auth-token').trim();
        const headerName = this._settings.get_string('http-auth-header').trim() || 'Authorization';
        if (token)
            message.request_headers.append(headerName, token);

        message.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(new TextEncoder().encode(requestBody))
        );

        const bytes = await sendAndReadAsync(this._httpSession, message);
        const responseText = new TextDecoder().decode(bytes.get_data());

        if (message.status_code < 200 || message.status_code >= 300) {
            throw new Error(`HTTP ${message.status_code}: ${responseText.trim() || 'Request failed.'}`);
        }

        const parsedText = parseResponseText(responseText);
        if (!parsedText)
            throw new Error('The HTTP backend returned an empty response.');

        return parsedText;
    }

    async _sendCommand(payload) {
        const commandLine = this._settings.get_string('command-path').trim();
        if (!commandLine)
            throw new Error('Command mode is enabled but no command was configured.');

        let argv;
        try {
            [, argv] = GLib.shell_parse_argv(commandLine);
        } catch (error) {
            throw new Error(`Invalid command line: ${error.message}`);
        }

        const proc = Gio.Subprocess.new(
            argv,
            Gio.SubprocessFlags.STDIN_PIPE |
            Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_PIPE
        );

        const {stdout, stderr, successful} = await communicateUtf8Async(proc, JSON.stringify(payload));
        if (!successful) {
            throw new Error(stderr.trim() || 'Configured command exited with a failure status.');
        }

        const parsedText = parseResponseText(stdout);
        if (!parsedText)
            throw new Error('The command transport returned an empty response.');

        return parsedText;
    }
}
