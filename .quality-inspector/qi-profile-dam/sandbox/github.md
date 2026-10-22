# GitHub sandbox

A throwaway GitHub user, an organization of its own, one repository, and an OAuth App there.
The inspector's tests sign in as that user to connect GitHub to an agent through DAM's real **Connect with GitHub** (OAuth), and the agent works in that repository.
It holds nothing real and nobody else; never use `dam-agents`, your own account, or another organization you care about.

1. **The test user.** Sign out of GitHub (or use a private window) and sign up a new account, for example `dam-qa-bot-<your initials>`, with an e-mail address you can read.
   - Give it a long random password of its own.
   - Turn on two-factor authentication with an **authenticator app**: Settings → **Password and authentication** → **Enable two-factor authentication**.
     On the QR code page, click **setup key** and keep that text — the TOTP secret (letters A–Z and digits 2–7).
     Add the same key to your own authenticator app as well, so you can sign in as the user yourself; finish the setup with its code and store the recovery codes somewhere safe.
   - Add no passkey or security key: the tests answer only the authenticator code.
2. **The organization.** As the test user: your avatar → **Your organizations** → **New organization**, Free plan.
   Pick a name without `_`, for example `dam-qa-sandbox-<your initials>`.
3. **The repository.** In it, create a **public** repository with a README, for example `e2e-playground` (again no `_`).
   Tell the inspector its name as `<organization>/<repository>` — it becomes `profile.sandbox_github_repo`.
4. **The OAuth App.** The organization → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
   - Application name: for example `DAM QA sandbox`.
   - Homepage URL: `http://localhost:4444`.
   - Authorization callback URL: `http://localhost:4444/api/oauth/callback`.
   - Leave **Enable Device Flow** off. **Register application**.
   - Keep the **Client ID**, then **Generate a new client secret** and keep it.
5. **The token.** As the test user: your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   - Resource owner: the sandbox organization.
   - Repository access: **Only select repositories** → the sandbox repository.
   - Repository permissions: **Issues: Read and write** (Metadata: Read-only is added by itself).
     Nothing else.
   - Expiration: the longest the organization allows; a new token later replaces this line.
   - If the organization asks to approve fine-grained tokens, approve this one under the organization's **Settings** → **Personal access tokens**.
6. **The lines.** In the agent's files on the platform, open `/home/agent/work/env/credentials.env` and fill — never paste any of them in chat:

   | Line                                      | Value                      |
   | ----------------------------------------- | -------------------------- |
   | `E2E_SANDBOX_GITHUB_TOKEN=`               | the token (`github_pat_…`) |
   | `E2E_SANDBOX_GITHUB_LOGIN=`               | the test user's login      |
   | `E2E_SANDBOX_GITHUB_PASSWORD=`            | its password               |
   | `E2E_SANDBOX_GITHUB_TOTP_SECRET=`         | the setup key from step 1  |
   | `E2E_SANDBOX_GITHUB_OAUTH_CLIENT_ID=`     | the OAuth App's client ID  |
   | `E2E_SANDBOX_GITHUB_OAUTH_CLIENT_SECRET=` | its client secret          |

7. **The egress.** The sign-in on `github.com` needs rules the inspector's kit denies by default (quality-inspector 3.9.0 or later): the inspector lists them as `by-hand` — add each one, with its method and path, in the agent's network settings.

The nested DAM gets the OAuth App as its GitHub default (`apiServer.oauthAppDefaults.github`), so **Connect with GitHub** needs no client ID in the form.
Issues the agent files in the repository carry the run's id in their title; the test closes them.
If GitHub ever asks the test user to verify a new device or to confirm its account settings, sign in as the user once yourself and answer it.
