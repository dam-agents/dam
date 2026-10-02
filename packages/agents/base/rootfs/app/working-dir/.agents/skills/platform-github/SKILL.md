---
name: platform-github
description: >
   Use before running `gh` or `git` against GitHub inside a Platform agent pod, and whenever GitHub answers 403 or 404 for a repository, organisation or user you expected to reach. Covers how GitHub credentials work here (the network gateway injects them, so there is no token to find or paste), how to see which GitHub accounts this agent holds (`gh auth status`), how to act as a different one (`gh auth switch`, or `gh auth token --user` for a single command), and what the gateway's "names no account" refusal means.
---

You are running inside a Platform agent pod. GitHub credentials never reach you: the network gateway injects the real token on the way out. What you hold, in `GH_TOKEN` or `GH_ENTERPRISE_TOKEN`, in gh's hosts file and in anything `gh auth token` prints, is a placeholder such as `platform:conn:<id>`. It names an account, and it is safe to pass around inside the pod.

## Hard rules

- Do not run `gh auth login`, paste a token, or edit `~/.config/gh/hosts.yml`. There is no real token to obtain, and a pasted one would bypass the platform.
- `PLATFORM_GH_TOKEN_AVAILABLE=true` means at least one GitHub account is granted to this agent. `false` means none is, or the first state has not arrived yet on a cold pod; treat it as "not yet known", not as permission to look for credentials elsewhere.

## See which accounts you hold

```
gh auth status
```

It lists every GitHub account granted to this agent, named after the platform Connections, and marks the active one. With one account there is nothing to choose. With several, the active one is what the platform user set as the default, and each account may reach different repositories.

## Act as another account

- `gh auth switch --user <account>` switches gh. `git` follows automatically through gh's credential helper, so clones, fetches and pushes act as the switched account too. With exactly two accounts, `gh auth switch` alone toggles.
- Switching changes which account authenticates, not the name and email on your commits: `user.name` and `user.email` stay the default account's, and a default account that signed in with a token has none. To commit as the switched account, pass its details explicitly, for example `git -c user.name="<name>" -c user.email="<email>" commit`; `gh api user` shows them for the account you switched to.
- For one command without switching:

  ```
  GH_TOKEN="$(gh auth token --user <account>)" gh api repos/<owner>/<repo>
  curl -H "Authorization: token $(gh auth token --user <account>)" https://api.github.com/user
  ```

  On a GitHub Enterprise Server host (`GH_HOST` is set to it), your credential is `GH_ENTERPRISE_TOKEN`, and gh treats that host as its default. When you also hold github.com accounts, name the host with `--hostname` on `gh auth token` and `gh auth switch`, and send the curl header to `api.$GH_HOST`.

- Every state push from the platform resets the active account to the default. A push follows any change to this agent's grants, default account, env, skills or name, including changes you make yourself. Switch again if you need the other one, and check `gh auth status` right before you push.

## When GitHub answers 403 or 404

- A repository can be visible to one of your accounts and not to another. Before concluding that it does not exist or that access is missing, run `gh auth status` and retry as each of the other accounts.
- A 403 whose body starts with "More than one connection injects the same credential header" is the gateway, not GitHub: the request named no account. Send it through `gh`, or add the placeholder header shown above. Never try to obtain a real token to get past it.

## Report, do not work around

If no account you hold can reach what the task needs, say so and stop. The platform user grants access; you never try other credentials.
