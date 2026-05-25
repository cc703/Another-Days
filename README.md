# Another-Days

Another-Days is a native WeChat Mini Program project built around habit check-ins, focus sessions, diary notes, mood traces, calendar review, and a profile/feedback surface.

## Stack

- Native WeChat Mini Program: `WXML`, `WXSS`, `JS`
- Cloud functions under `cloudfunctions/`
- Single routed business API surface: `cloudfunctions/api_v2`

## Project Structure

- `miniprogram/` - mini program source
- `cloudfunctions/` - cloud functions
- `scripts/` - local verification and deployment helper scripts
- `i18n/` - locale resources

## Local Development

Open the project in WeChat DevTools and point the tool at this repository root.

Before running it, replace these placeholders with your own values:

- `project.config.json` -> `appid`
- `miniprogram/config/cloud.js` -> `env`

## Verification

Run the lightweight regression suite locally:

```powershell
node scripts/run-tests.js
```

## Notes

- This public repository intentionally excludes local docs, private config, release artifacts, and runtime orchestration state.
- The daily reminder feature is currently paused in the UI and shows a placeholder message instead of requesting live subscription-message authorization.
