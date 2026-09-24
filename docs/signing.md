# Release signing (placeholder)

REELMIND is currently unsigned during development (`npm run package` produces an
unsigned NSIS installer). Before distributing outside sideloading:

1. Obtain a Windows code-signing certificate (OV/EV).
2. Set `CSC_LINK` (path or URL to .p12/.pfx) and `CSC_KEY_PASSWORD` in the
   packaging environment, or configure `build.win.certificateSubjectName`.
3. Verify `electron-builder` signs `release/*.exe` and that SmartScreen trusts
   the publisher.

Until signing is configured, distribute via sideloading and document the
installer hash. See `scripts/build.mjs` and `electron-builder` docs. Do not
check certificates or passwords into the repository.
