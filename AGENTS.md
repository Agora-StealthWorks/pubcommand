# Agents

Every coding agent (Claude Code, Codex, Cursor, Copilot and others) follows `CLAUDE.md`.

The short version: when you change what the app does, update its doc in the same commit
(`modules/<app>/README.md`, `docs/*.md`, `DEPLOY.md`). Those docs are synced into the Master
Brain (Operations → How PubCommand works), which is how the Brain and the platform AI agents know
how PubCommand works today. And log every user action with `appendOrgAudit()` /
`appendPlatformAudit()` so the Usage page and the Operations Brain see it.
