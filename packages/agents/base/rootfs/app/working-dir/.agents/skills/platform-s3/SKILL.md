---
name: platform-s3
description: >
  Use before reading or writing an S3-compatible bucket (IBM Cloud Object Storage, AWS S3, MinIO, Ceph) inside a Platform agent pod, and whenever an S3 request fails with a signature error or a 400 or 403 from the egress gateway. Covers how S3 keys work here (the gateway signs every request, so the keys you hold are placeholders), which buckets this agent holds (`grep '^\[' ~/.aws/credentials`), how to pick one (`AWS_PROFILE`, `--profile`), how to install a client on demand (`uv tool install awscli`, `uv pip install boto3`), what the gateway's STREAMING and out-of-bucket refusals mean, and what does not work (presigned URLs, rclone, minio-go).
---

You are running inside a Platform agent pod. S3 keys never reach you: the network gateway re-signs every request with the real HMAC key pair on the way out. What you hold in `~/.aws/credentials` is a placeholder access key ID such as `platform:conn:<id>` and a dummy secret key. The placeholder names a Connection, and it is safe to pass around inside the pod.

## Hard rules

- Do not run `aws configure`, paste keys, or set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_ENDPOINT_URL`. There is no real key to obtain, and such env overrides the profiles the platform wrote, which carry the settings the gateway needs.
- Do not edit the profile sections the platform wrote in `~/.aws/credentials` or `~/.aws/config`. Every state push rewrites them. Your own `[default]` profile and anything else in those files is left alone.

## See which buckets you hold

```
grep '^\[' ~/.aws/credentials
echo "$AWS_PROFILE"
```

Each `[<profile>]` section is one storage Connection granted to this agent, named after the Connection. Its `[profile <profile>]` section in `~/.aws/config` carries the endpoint, the signing region, path-style addressing and `request_checksum_calculation = when_required`. `AWS_PROFILE` names the profile the platform user set as the default, or the earliest grant. With one profile there is nothing to choose.

A profile is a key pair plus an endpoint; the bucket is not in the config. Read the Connection's description or ask the user which bucket to use. When the Connection is limited to one bucket, requests to any other bucket on that endpoint are refused by the gateway.

## Install a client

No S3 client is baked into the image. Install one when you need it:

```
uv tool install awscli        # aws-cli v1: aws s3 ls, cp, sync, rm
uv pip install boto3          # from Python
```

Both read the profiles as they are. Always address buckets by name, never by subdomain: `aws s3 ls s3://<bucket>` and `boto3.client("s3").list_objects_v2(Bucket=...)` are right; `https://<bucket>.<endpoint>` is not, and the profile already forces path-style addressing for this reason.

## Act as another profile

- `AWS_PROFILE=<profile> aws s3 ls s3://<bucket>` or `aws --profile <profile> ...` for one command.
- `export AWS_PROFILE=<profile>` for the rest of the shell. A state push from the platform resets the default; it follows any change to this agent's grants, default Connection, env, skills or name, including changes you make yourself.
- In boto3: `boto3.Session(profile_name="<profile>").client("s3")`.

## When the gateway refuses a request

- A 400 whose body says the gateway re-signs requests and cannot re-sign a streaming upload: the client sent an `aws-chunked` body with a trailing checksum, which cannot be re-signed. The profiles the platform writes already set `request_checksum_calculation = when_required`, which prevents it. You see this only when a client ignored the profile, usually because `AWS_REQUEST_CHECKSUM_CALCULATION`, a key env or a hand-built config overrides it. Remove the override; do not retry with other keys.
- A 403 whose body says the storage connection is limited to a bucket: the request named a bucket outside the one the Connection was created for, and the gateway did not sign it. Use that bucket, or another profile whose Connection covers the path. The platform user chose the bucket; report it, do not work around it.
- `SignatureDoesNotMatch` or `InvalidAccessKeyId` from the endpoint itself means the request never named a Connection the gateway could sign for. Send it through a platform profile with its placeholder as the access key ID.
- `AccessDenied` is the key's own permission limit on the endpoint. The platform user chose the keys; report it, do not work around it.

## What does not work here

- Presigned URLs you generate: they are signed with the dummy key, so nobody can use them. Download or upload the object yourself and hand over the bytes or a published artifact instead.
- `rclone`, `minio-go` and other clients that do not read AWS profiles: they need their own config with the same placeholder access key ID, any secret key, the endpoint, path-style addressing and plain (non-streaming) uploads. Prefer the AWS CLI or boto3.
- Endpoints the cluster cannot reach, such as a private network, are out of reach for the gateway too.

## Report, do not work around

If no profile you hold can reach what the task needs, say so and stop. The platform user grants storage; you never try other keys.
