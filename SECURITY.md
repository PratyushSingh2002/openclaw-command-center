# Security Policy

OpenClaw Mini Chat runs the configured OpenClaw executable from a GNOME Shell dropdown. Treat the configured command path as trusted local code.

## Reporting

If you find a security issue, please do not open a public issue with exploit details. Contact the maintainer privately first, then coordinate disclosure.

## Notes

- The extension does not execute arbitrary shell strings from chat input.
- Slash commands are passed as arguments to the configured OpenClaw executable.
- Generated packages should be rebuilt from source before release.

