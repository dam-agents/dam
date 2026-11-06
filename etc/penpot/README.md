# Penpot for the design evaluation

[Penpot](https://penpot.app) is an open-source design tool, and the candidate to replace Figma for our design work.
Its MCP server lets an agent read and change a design, so a developer agent can work from the design itself.
This folder installs Penpot, its MCP server, and the PostgreSQL and Valkey it needs, into one namespace of a cluster, for a trial.

It is not part of the platform chart, and no platform install depends on it.

## Files

| File                                                                  | What it is                                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`values.yaml`](values.yaml)                                          | Values for Penpot's own chart, `penpot` from `https://helm.penpot.app`: feature flags, Secret names, resources.   |
| [`values-openshift.yaml`](values-openshift.yaml)                      | Added on OpenShift: drops the chart's fixed `fsGroup`, which the `restricted-v2` SCC refuses.                     |
| [`dependencies.yaml`](dependencies.yaml)                              | PostgreSQL 18 and Valkey 9, one replica each, on the Red Hat hardened images the platform chart also runs.        |
| [`install`](../../.mise/tasks/penpot/install) (`.mise/tasks/penpot/`) | `mise run penpot:install`: makes the namespace and the Secret, applies the dependencies, then installs the chart. |

## Install

Point `kubectl` at the cluster, then:

```sh
mise run penpot:install -- --public-uri https://penpot.apps.<cluster domain> --openshift
```

- `--public-uri` is the address people open; Penpot builds its links and the MCP server's address from it.
- `--openshift` adds `values-openshift.yaml` and makes a Route for that host, with edge TLS and a one-hour timeout, so the MCP plugin's WebSocket stays open.
  The task makes the Route itself: the chart's own Route writes its TLS keys under names the Route API does not know.
  On another cluster, leave it out and give the `penpot` Service (port 8080) an Ingress of your own.
- `--namespace` picks another namespace than `penpot`.

Run it again to upgrade.
It makes the `penpot-secrets` Secret (the API key and the database and Valkey passwords) on the first run only, and the volumes keep the data.
To move to a newer Penpot, change `chart_version` in the task.

On OpenShift the chart drops its fixed user IDs by itself (`global.compatibility.openshift.adaptSecurityContext: auto`), and `values-openshift.yaml` drops the fixed group, so the pods run under the `restricted-v2` SCC with the user and group OpenShift gives them.

## Sign in

Anyone who opens the address can register with an e-mail and a password; there is no e-mail check, as there is no SMTP.
For a trial behind the cluster's network, that is enough.
For a longer one, set `config.registrationDomainWhitelist` in `values.yaml` to our domain, or connect single sign-on through the chart's `config.providers.oidc`.

## Connect an agent to the MCP server

Penpot's MCP server does its work through a design file open in a browser: the agent's tools run in that tab.

1. In Penpot, open **Your account → Integrations**, turn **MCP Server** on, and make an **MCP key**.
   The page shows the server URL, `https://<penpot host>/mcp/stream?userToken=<key>`.
   The key is shown once; one person has one key, and a new one revokes the old.
2. Open a design file, then the main menu → **MCP server → Connect**.
   Keep that tab open and in front: a tab the browser puts to sleep disconnects the agent.
   The tab can be a person's, or the agent's own browser signed in to Penpot.
3. In DAM, add the URL to the agent as a custom Connection → **Add MCP server**.
   The key is in the URL, so treat the URL as a secret.

The agent then has four tools: `high_level_overview`, `penpot_api_info`, `execute_code` (runs Plugin API code in the open file) and `export_shape`.
The server runs in Penpot's multi-user mode, so it never touches the agent's own files: `export_shape` cannot write to a path, and importing an image from a path is not offered.

## Remove it

```sh
helm uninstall penpot -n penpot
kubectl delete namespace penpot
```

Deleting the namespace deletes the volumes and every design in them; export the files a person wants to keep first.
