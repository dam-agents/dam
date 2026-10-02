---
name: platform-s3
description: >
   Use before running the AWS CLI, boto3 or any S3 client against object storage inside a Platform agent pod, and whenever an S3 request fails with a 400 that mentions "when_required" or STREAMING, or with a 403. Covers the AWS profiles the platform writes for each S3-compatible storage Connection granted to this agent, why the keys in them are placeholders, how to pick a profile (`--profile`, `AWS_PROFILE`), how to install a client, and what the gateway cannot do (presigned URLs, clients with their own config).
---

You are running inside a Platform agent pod. S3-compatible storage keys never reach you: the network gateway signs each request on the way out. The access key ID in your AWS config is a placeholder such as `platform:conn:<id>` that names a storage Connection, and the secret access key is a dummy. Both are safe to pass around inside the pod.

## Hard rules

- Do not set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` or `AWS_ENDPOINT_URL`, and do not edit the profiles the platform wrote. They override the profiles, and the gateway rejects a request whose access key ID is not a placeholder it knows.
- Do not look for real keys. The platform user grants access; you never try other credentials.

## See which storage you hold

```
grep '^\[' ~/.aws/credentials
cat ~/.aws/config
echo "$AWS_PROFILE"
```

There is one profile per granted storage Connection, named after it in lower case. The config shows each profile's endpoint and region. `AWS_PROFILE` is the platform user's default; with one Connection there is nothing to choose. `default` is never used, so a profile you add yourself under that name is left alone.

## Use a profile

- `aws --profile <name> s3 ls s3://<bucket>` picks one for a command; `AWS_PROFILE=<name>` for a shell.
- Every state push from the platform resets `AWS_PROFILE` to the default. A push follows any change to this agent's grants, default storage, env, skills or name. Pass `--profile` explicitly in scripts.
- A Connection may be limited to one bucket. A request to another bucket on the same endpoint is refused by the gateway.

## Install a client

Nothing is preinstalled.

- `uv tool install awscli` gives aws-cli v1, which reads the profiles as they are.
- `uv pip install boto3` for Python: `boto3.Session(profile_name="<name>").client("s3")` picks up the endpoint, region and path-style addressing from the profile.

## When a request fails

- 400 from the gateway saying it "re-signs requests" and naming `when_required`: the client sent a streaming checksum body that the gateway cannot re-sign. The profile already sets `request_checksum_calculation = when_required`. You see this when the client ignores the profile, so check that it reads `~/.aws/config` and that `AWS_REQUEST_CHECKSUM_CALCULATION` is not set to something else. For one command, `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` fixes it.
- 403 `SignatureDoesNotMatch` or `InvalidAccessKeyId`: the request did not go through a platform profile, or named an access key ID the gateway does not know. Use `--profile`.
- 403 `AccessDenied` from the storage service: the Connection's real keys lack that permission. Report it.

## Limits

- No presigned URLs: they are signed locally with the dummy secret, so the storage service rejects them.
- rclone, minio-go and other clients that do not read `~/.aws` need their own config: set the endpoint to the one in `~/.aws/config`, the access key ID to the placeholder from `~/.aws/credentials`, any secret, path-style addressing, and `when_required` checksums where the client has the option.

## Report, do not work around

If no profile you hold can reach what the task needs, say so and stop.
