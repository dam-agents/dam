# Secrets

Last verified: 2026-06-12

## Storage

CI/CD secrets (Quay registry credentials, deploy tokens) are stored as GitHub **repository secrets** and referenced in workflow files. No secrets are checked into the repo.

## Scanning

GitHub **secret scanning** with **push protection** is enabled on the repository. Push protection blocks commits that contain recognized secret patterns (API keys, tokens, private keys) before they reach the remote — the push is rejected and the author is notified.

Alerts for any secrets that bypass push protection surface in **Settings → Code security → Secret scanning**.
