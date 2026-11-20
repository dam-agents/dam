# Slack token rotation

Last verified: 2026-11-20

How the Slack credentials renew themselves where the Slack app has token rotation turned on: each workspace's bot token, and the one App-Level Token that opens the Socket Mode connection.
Where each token comes from, and what the Slack worker does with it, lives on [channels](channels.md).

## One switch, two kinds of token

Token rotation is one switch on the Slack app, and Slack cannot turn it off again.
With it on, a token lives twelve hours and comes with a single-use refresh token, which buys the next pair.
A token minted before the switch was on keeps not expiring until it is exchanged for a rotating pair, one call per token.
The install's own rotation setting tells the api-server that the switch is on, and it covers both kinds of token.
The setting only starts exchanges: renewing depends on what a Secret holds, so turning the setting back off changes nothing for a token already exchanged.

## Bot tokens

With rotation on, the install handshake mints a bot token that expires, together with its refresh token, and both go into the workspace's Secret.
The token is swapped for a fresh pair once it is an hour old — by a sweep every ten minutes, or by whichever replica needs it first — so an outage has eleven hours to pass before any workspace goes dark, and Slack's two-live-tokens-per-workspace limit is never crossed.
The swap runs under the workspace's lock — two replicas spending the same refresh token would leave one holding a revoked pair — with the Secret re-read inside the lock so the later one takes what the earlier one wrote.
A refresh that fails while the token still works keeps serving it; once the token has expired, a refresh Slack refuses as a dead credential marks it like any other rejection, while a refusal that may pass — being rate limited — or one Slack never answered leaves it unmarked for the next try.
Slack reports revoked tokens by workspace rather than by token, and a rotated-out token may be the one it reports, so a revocation marks the credential only when the workspace's current token is refused too.

A bot token minted before rotation was on is exchanged in one sweep as soon as the lease-holding replica's socket is up, under the same lock.
Slack retires the old token as it answers, so the pair replaces it in the workspace's Secret at once.
A failed exchange keeps serving the old token and tries again later.

## The App-Level Token

The App-Level Token comes from Helm values, and the Helm value alone decides whether the Slack worker runs.
With rotation on, the value is a one-time import: on the first connect it is exchanged for a rotating pair, which goes into one install-wide Secret with a fingerprint of the Helm value, and the Secret answers from then on.
A restart, or another replica, reads the pair from the Secret and never exchanges the Helm value again.
With rotation off and nothing stored, the Helm value is served as it is.

The pair is renewed at the bot tokens' pace — once the token is an hour old, by the same ten-minute sweep or by the next connect — under one install-wide lock with the Secret re-read inside it.
Slack retires the Helm token after the first renewal, so a copy of the Helm value is useless within hours.
The Socket Mode connection asks for the token again on every connect, so a reconnect always uses the token renewed last, whichever replica renewed it.

A failed exchange keeps the socket on the Helm token and tries again ten minutes later; a failed renewal keeps the current token while it is valid.
Once the token has expired and Slack refuses its refresh token as dead, the Secret is marked refused, nothing is served and the socket stays down, with an error in the api-server log on each try.
The way back is an operator act: generate a new App-Level Token in the Slack app and set it in Helm values.
A Helm value whose fingerprint differs from the stored one is imported again, replacing the refused pair.
A rotating token pasted into Helm values has no refresh token to go with it, so the api-server warns of it at boot.
