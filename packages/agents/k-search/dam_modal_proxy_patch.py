"""Route the Modal client through DAM's HTTP CONNECT egress gateway.

DAM agent pods reach the network only via an explicit HTTPS_PROXY (the paired
Envoy gateway); direct egress and DNS are blocked. The modal client ignores
HTTPS_PROXY on both of its transports, so without this patch its traffic is
dropped. Two gaps closed here:

  1. grpclib (Modal control plane, api.modal.com) has no proxy support — patch
     Channel._create_connection to CONNECT through the proxy, then layer TLS
     end-to-end (the gateway L4-passes the tunnel; the token stays in-pod).
  2. Modal's aiohttp blob client (GCS / Cloudflare R2 / S3 uploads) is built
     without trust_env — rebuild the session factory with trust_env=True so it
     honors HTTPS_PROXY.

Auto-loaded at interpreter startup via a .pth file, so it also covers the
run_and_check.py subprocess that performs the Modal evaluation. A no-op when
HTTPS_PROXY is unset.
"""
import os
import socket
import sys
from urllib.parse import urlparse


def _proxy_target():
    raw = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if not raw:
        return None
    u = urlparse(raw if "://" in raw else f"http://{raw}")
    return u.hostname, u.port or 80


import grpclib.client as _gc

_orig_create_connection = _gc.Channel._create_connection


async def _connect_via_proxy(self):
    proxy = _proxy_target()
    if proxy is None or self._path is not None:
        return await _orig_create_connection(self)
    loop = self._loop
    # Resolve the proxy address family (don't assume IPv4) so an IPv6-only
    # proxy still works.
    family, socktype, proto, _, sockaddr = (
        await loop.getaddrinfo(proxy[0], proxy[1], type=socket.SOCK_STREAM)
    )[0]
    sock = socket.socket(family, socktype, proto)
    sock.setblocking(False)
    await loop.sock_connect(sock, sockaddr)
    await loop.sock_sendall(
        sock,
        f"CONNECT {self._host}:{self._port} HTTP/1.1\r\n"
        f"Host: {self._host}:{self._port}\r\n\r\n".encode(),
    )
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = await loop.sock_recv(sock, 4096)
        if not chunk:
            sock.close()
            raise ConnectionError("proxy closed during CONNECT")
        data += chunk
    if b" 200 " not in data.split(b"\r\n", 1)[0]:
        sock.close()
        raise ConnectionError(f"proxy CONNECT failed: {data.splitlines()[0]!r}")
    _, protocol = await loop.create_connection(
        self._protocol_factory,
        sock=sock,
        ssl=self._ssl,
        server_hostname=(
            (self._config.ssl_target_name_override or self._host)
            if self._ssl is not None
            else None
        ),
    )
    return protocol


_gc.Channel._create_connection = _connect_via_proxy

try:
    import modal._utils.http_utils as _hu

    def _http_client_with_tls_trustenv(timeout):
        import ssl

        import certifi
        from aiohttp import ClientSession, ClientTimeout, TCPConnector

        ctx = ssl.create_default_context(cafile=certifi.where())
        return ClientSession(
            connector=TCPConnector(ssl=ctx),
            timeout=ClientTimeout(total=timeout),
            trust_env=True,
        )

    _hu._http_client_with_tls = _http_client_with_tls_trustenv
except Exception as exc:  # modal absent / API drift
    print(f"[dam-modal-proxy] modal aiohttp patch skipped: {exc}", file=sys.stderr)

if _proxy_target():
    print("[dam-modal-proxy] active (grpclib + modal aiohttp -> HTTPS_PROXY)", file=sys.stderr)
