# Security and privacy

Keys are stored in Windows Credential Manager, never in SQLite or the repository. The desktop renderer receives key-presence flags, not stored key values. Cloud analysis sends transcript text and structured timing metadata; it does not upload video or audio. Transcripts can still contain sensitive information: disable cloud analysis for private recordings.

The GitHub source ZIP contains no installer, runtime, or personal keys. Use the Setup EXE from the Releases page on another Windows computer, then enter keys in that computer's app Settings if desired. Do not copy Credential Manager data between machines.

Do not publish credentials, application databases, transcripts, crash dumps or personal media in issues. If a credential has been shared publicly, revoke it with its provider and replace it through Settings. Ignoring a file does not remove it from existing Git history.

Before committing, stage only intended source changes and run `npm run check:secrets`. Enable the local hook with `git config core.hooksPath .githooks`. It scans staged content for common key formats, private keys and private/build artifacts; it cannot detect every possible secret.

Use GitHub private vulnerability reporting if enabled. Otherwise contact the maintainer privately before posting sensitive details. This personal-use V1 has not had an independent security audit.

The local installer is unsigned. Before public binary distribution, complete real-media validation, signing if desired, and the bundled dependencies' license/source-distribution requirements described in THIRD_PARTY.md. Do not bundle personal credentials or app data in a release.
