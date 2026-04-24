# Windows Release Checklist

## Preflight

- Ensure `package.json` and `package-lock.json` use the same app version.
- Run `npm ci` on a clean working tree.
- Run `npm run typecheck` and `npm test`.

## Build

- Build renderer and Electron bundles with `npm run build:electron`.
- Create installer artifacts with one of:
  - `npm run package:win`
  - `npm run package:nsis`
  - `npm run package:portable`
- Validate generated files in `release/<version>/`.

## Security Posture

- Keep `requestedExecutionLevel` as `asInvoker` to avoid unnecessary always-admin startup.
- Require elevation only for TUN workflow via runtime UAC relaunch path.
- For public releases, enable code-signing in CI using certificate secrets:
  - `CSC_LINK`
  - `CSC_KEY_PASSWORD`
- For unsigned internal builds, clearly mark artifacts as internal-only.

## Smoke Test Matrix

- Proxy mode:
  - Launch app without UAC.
  - Connect/disconnect and confirm system proxy is toggled.
- TUN mode:
  - Start connect flow and confirm UAC prompt/relaunch path.
  - Verify routes are configured and cleaned up on disconnect.

## Publish

- Tag release with the same semantic version as `package.json`.
- Publish installer checksums together with artifacts.
