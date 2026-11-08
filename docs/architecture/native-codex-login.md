# Native Codex subscription login

Last verified: 2026-11-08

An owner can enable a ChatGPT subscription Connection and grant it to an agent alongside other provider Connections.
Subscription models use the `chatgpt` provider alias, while API models use `openai`, so replacing Connections cannot silently change a saved model's billing path.
The Connection configures Codex's native mode and permits its authentication and inference hosts; it stores no subscription token in the platform.
The owner authorizes the agent with its Providers page’s device-sign-in action or over SSH, and Codex stores, refreshes and removes its login in the persistent home.
The device-sign-in action uses the existing owner-only terminal transport and a fixed Codex command; it requires the native provider grant.
It starts only after an owner clicks Sign in, never during a status check.
The agent’s Providers page reads Codex’s saved login status with a bounded command and returns only a state and timestamp, without CLI output or credentials.
Status and device authorization use Codex’s current harness environment, including its configured credential directory.
Signed in means Codex recognizes a saved ChatGPT login; a turn still verifies account access.
An unavailable check or sleeping agent never implies a signed-in state.
Connection inheritance does not authorize a platform sub-agent: its own persistent home needs its own login.
That login serves terminal, web and channel sessions selecting the subscription's native models.
The harness and its tools can read the account's tokens, so everyone allowed to run work on the agent uses that subscription; a channel binding lends this account access to the channel too.
Native requests still leave through the gateway and its network gate, but bypass the Model Router and its provider metering and spend limits.
The provider being configured is not proof that an agent is signed in or entitled to a particular model.
Detaching or deleting the Connection removes managed selection, not the native login: the owner logs out on the agent to remove its cached credentials.
Reauthorizing an expired login, changing accounts or logging out requires an agent restart because existing Codex processes cache their account.
The OpenAI API-key mode never requires or clears that native login.

