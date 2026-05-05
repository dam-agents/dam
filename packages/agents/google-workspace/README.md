# Google Workspace Agent

A Humr agent template with the [Google Workspace CLI (`gws`)](https://github.com/googleworkspace/cli) pre-installed for managing Google Drive, Gmail, Calendar, Sheets, and more.

## Setup

### 1. Create a Google Cloud OAuth App

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use an existing one)
3. **Enable APIs** — go to **APIs & Services > Library** and enable:
   - Google Drive API
   - Gmail API
   - (Optional) Google Sheets API, Google Calendar API
4. **Configure OAuth consent screen** — go to **APIs & Services > OAuth consent screen**:
   - User type: **External** (or **Internal** if on Google Workspace)
   - App name: anything (e.g., "Humr Agent")
   - Add scopes: `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/gmail.modify`
   - Add your Google email as a **test user**
5. **Create OAuth Client ID** — go to **APIs & Services > Credentials > + Create Credentials > OAuth client ID**:
   - Application type: **Web application**
   - Add **Authorized redirect URIs**:
     - `http://localhost:4444/api/apps/google-drive/callback`
     - `http://localhost:4444/api/apps/gmail/callback`
   - Save the **Client ID** and **Client Secret**

### 2. Connect Google Drive in DAM

1. Open the DAM UI at http://localhost:4444
2. Navigate to **Connections**
3. Add **Google Drive** with your **Client ID** and **Client Secret** from step 1
4. Complete the Google OAuth consent flow
5. Grant the google-workspace agent access to this connection

### 3. Create an Agent

1. Create a new agent from the **google-workspace** template
2. Create an instance
3. Open the chat and try: "list my Google Drive files" or "triage my Gmail inbox"

## How It Works

The agent authenticates to Google APIs through DAM's credential injection ([ADR-033](../../../docs/adrs/033-envoy-credential-gateway.md)):

1. When you grant a `gmail` or `google-drive` connection in the agent's Configure dialog, DAM auto-populates `GOOGLE_WORKSPACE_CLI_TOKEN=humr:sentinel` into the agent's editable env list. You can edit or remove it like any custom env var.
2. When `gws` makes a request to `*.googleapis.com`, it sends `Authorization: Bearer humr:sentinel`.
3. The request goes through the in-pod Envoy sidecar (`HTTPS_PROXY=http://127.0.0.1:<port>`).
4. The sidecar's filter chain for the Google host swaps the sentinel for the real Bearer token, sourced from a K8s Secret mounted into the sidecar only.
5. Google receives a valid access token.

The agent container never sees your real Google credentials — the Secret is mounted into the sidecar, not the agent.

## Token Lifecycle

DAM stores the OAuth refresh token in a K8s Secret and runs a refresh loop in the api-server that re-mints the access token before it expires. No manual intervention is needed after the initial OAuth consent.
