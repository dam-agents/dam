# GitHub sandbox

A throwaway organization the agent under test files issues in.
It holds nothing real and nobody else; never use `dam-agents` or another organization you care about.

0. **Whose account.** Your own GitHub account may create the organization and the token: the token reaches only the sandbox repository.
   For a dedicated owner instead, create a GitHub user with a Google Workspace address made as in `sandbox/slack.md` step 0 (for example the alias `qa-github@<domain>`).
   GitHub allows one machine account per person; enable two-factor authentication on it.
1. Create an organization on the Free plan: github.com → your avatar → **Your organizations** → **New organization**.
   Pick a name without `_`, for example `dam-qa-sandbox-<your initials>`.
2. In it, create a **public** repository with a README, for example `e2e-playground` (again no `_`).
   Tell the inspector its name as `<organization>/<repository>` — it becomes `profile.sandbox_github_repo`.
3. Create the token: your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   - Resource owner: the sandbox organization.
   - Repository access: **Only select repositories** → the sandbox repository.
   - Repository permissions: **Issues: Read and write** (Metadata: Read-only is added by itself).
     Nothing else.
   - Expiration: the longest the organization allows; a new token later replaces this line.
   - If the organization asks to approve fine-grained tokens, approve this one under the organization's **Settings** → **Personal access tokens**.
4. In the agent's files on the platform, open `/home/agent/work/env/credentials.env` and put the token (`github_pat_…`) after `E2E_SANDBOX_GITHUB_TOKEN=`.
   Never paste it in chat.

Issues the agent files there carry the run's id in their title; the test closes them.
