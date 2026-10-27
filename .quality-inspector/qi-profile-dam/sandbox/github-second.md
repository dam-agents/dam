# GitHub sandbox — the second test user

A second throwaway GitHub user in the GitHub sandbox's organization (`sandbox/github.md`).
The tests sign it in through DAM's **Authorize with GitHub** as a second person, for checks with two people: a second DAM account with a GitHub of its own, two people working on one repository.
It uses the first user's organization, repository and OAuth App; set those up first.
It is optional: leave its lines empty, and a check that needs two GitHub users is `testable: no` while every other check runs.
It holds nothing real; never use your own account.

1. **The user.** Sign out of GitHub (or use a private window) and sign up a second account, for example `dam-qa-bot2-<your initials>`, with an e-mail address you can read, never the first user's.
   - The tests sign in with a password and an authenticator code only, never with **Continue with Google** or another provider.
     An account made through such a provider has no password yet: set one at github.com/password_reset with its e-mail address, a long random password of its own.
   - Turn on two-factor authentication with an **authenticator app**: Settings → **Password and authentication** → **Enable two-factor authentication**.
     On the QR code page, click **setup key** and keep that text — the TOTP secret (letters A–Z and digits 2–7).
     Add the same key to your own authenticator app as well, finish the setup with its code and store the recovery codes somewhere safe.
   - Add no passkey or security key.

2. **The organization.** As the first test user: the sandbox organization → **People** → **Invite member** → the second user, role **Member**; accept the invitation as the second user.
   A member, not an outside collaborator: only an organization's members may pick it as a token's resource owner (step 3).
   Then the repository → **Settings** → **Collaborators and teams** → give the second user **Write** (not Admin).

3. **The token.** As the second user: your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   - Resource owner: the sandbox organization.
   - Repository access: **Only select repositories** → the sandbox repository.
   - Repository permissions: **Contents: Read and write**, **Issues: Read and write**, **Pull requests: Read and write**.
     Nothing else.
   - Expiration: the longest the organization allows.
   - If the organization asks to approve fine-grained tokens, approve this one under the organization's **Settings** → **Personal access tokens**.

4. **The lines.** In the agent's files on the platform, open `/home/agent/work/env/credentials.env` and fill — never paste any of them in chat:

   | Line                               | Value                      |
   | ---------------------------------- | -------------------------- |
   | `E2E_SANDBOX_GITHUB2_TOKEN=`       | the token (`github_pat_…`) |
   | `E2E_SANDBOX_GITHUB2_LOGIN=`       | the second user's login    |
   | `E2E_SANDBOX_GITHUB2_PASSWORD=`    | its password               |
   | `E2E_SANDBOX_GITHUB2_TOTP_SECRET=` | the setup key from step 1  |

No egress of its own: the second user signs in through the same pages and works in the same repository as the first.
If GitHub ever asks the second user to verify a new device or to confirm its account settings, sign in as the user once yourself and answer it.
