# Personal VPS inference

The same private inference service can run on a personal Linux VPS with Docker. The public Elsewhere world calls its authenticated HTTPS endpoint; OAuth tokens and refreshes stay on the VPS. Your laptop can be off after handoff. This follows OpenAI's [self-hosted VM workflow](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms) for your own authorized resident. It does not enable public ChatGPT enrollment for other owners.

## Prepare the service

Use an isolated checkout and the existing server reverse proxy. Do not replace another application's Compose files or proxy configuration. From the checkout:

```sh
cp infra/vps/inference.env.example infra/vps/.env.vps.local
chmod 600 infra/vps/.env.vps.local
# Privately configure HUBERT_OWNER_USER_ID and a fresh INFERENCE_BROKER_TOKEN.
docker compose -f infra/vps/compose.yaml up -d --build
```

The named project `elsewhere-hubert-inference` preserves its broker-only volume across ordinary redeploys. Do not run `down --volumes`: it would destroy the OAuth session and durable allowance. The service binds only `127.0.0.1:4100` on the host; it drops Linux capabilities, uses a read-only root filesystem and has no Docker socket, host SSH keys or other application data mounted. Its protected data volume is writable by the container's non-root `node` user.

The owner ID must match the private owner binding used by the deployed world. A platform administrator role does not establish that binding. Missing OAuth credentials keep the process alive but inference unavailable, allowing the initial import without consuming model quota.

If no Elsewhere owner account exists yet, leave `HUBERT_OWNER_USER_ID` unset. The installed service reports healthy liveness but has no model grant, provider dispatch or allowance database. Its protected readiness stays false, and session import refuses to proceed. Bind the actual owner and restart only this project before handing off OAuth; do not invent a temporary owner or copy tokens early.

Add a dedicated HTTPS site to the server's reverse proxy. `infra/vps/Caddyfile.example` is a host-Caddy example using `HUBERT_INFERENCE_HOST`; it forwards only decision, reflection and protected readiness routes to localhost. A reverse proxy running in Docker must instead reach the broker on an explicitly shared network; `127.0.0.1` inside another container is not the VPS host. Use a hostname you control that points to the VPS and validate TLS before installing the world service credential. Do not expose raw port 4100 or enable request-body/credential debug logging. A network allowlist or private VPN can further restrict which backend can reach the endpoint.

On the world runtime, install only:

```dotenv
MODEL_PROVIDER=broker
HUBERT_OWNER_USER_ID=the-same-private-owner-account-id
INFERENCE_BROKER_URL=https://your-dedicated-inference-host.example
INFERENCE_BROKER_TOKEN=the-same-dedicated-service-secret
MODEL_MAX_CALLS_PER_DAY=20
```

Do not put OAuth tokens or these service credentials in Vercel's browser environment. The world asserts its expected owner/world/character/connection binding; a mismatched endpoint is refused before provider dispatch. The broker retains its own independent daily cap.

## Transfer the selected ChatGPT session

First verify the SSH host key and ordinary key-based access to the VPS. SSH configuration aliases, configured ports and keys are respected. The command requires existing trusted host-key verification and noninteractive authentication; on macOS it uses the existing SSH keychain support. It never asks for a password in chat or transfers SSH keys.

Stop local processes using this profile. Then run locally:

```sh
pnpm chatgpt transfer --profile default \
  --destination your-vps-ssh-alias \
  --container hubert-inference \
  --owner-user-id YOUR_HOSTED_ELSEWHERE_USER_ID
```

`--container` executes only the fixed broker import command through `docker exec -i`; no arbitrary remote command is accepted. The SSH user needs permission to execute that command against the intended container. Without `--container`, the existing direct `/app/dist/inference-operator.mjs` flow remains available for hosts such as Render.

The source is quarantined before transmission. Interrupted transfers can retry only the same SSH destination, container, profile and owner; they cannot overwrite remotely rotated credentials or reactivate the source. SSH alias/host, username and Docker container names are validated, and tokens travel only through encrypted stdin. The receiving host ID is generated separately and preserved.

Safe remote status uses the existing SSH account and container:

```sh
ssh your-vps-ssh-alias docker exec hubert-inference \
  node /app/dist/inference-operator.mjs status
```

Use the [ownership/hosting guide](ownership-and-hosting.md) for grant semantics, recovery and limits. Neither the VPS profile nor its setup provisions another resident: Hubert remains the only admitted character.

## Shared game-server hosts and private TLS

On a host with an existing game server or stopped proxy stack, preserve its configured ports as well as its files. The optional Linux overlay `compose.pinned-tls.yaml` listens on TCP 9443 instead of taking ports 80/443. Its immutable Caddy image, certificate directory and container are separate from existing proxies. It disables the admin API, HTTP redirects, ACME and HTTP/3, so it does not open extra listeners or renew another site's certificates.

Generate a dedicated self-signed TLS certificate with the VPS DNS name in its subject alternative names; keep its private key in the protected `infra/vps/tls/key.pem` file and its public certificate in `cert.pem`. Those files must never enter Git. The world receives only the PUBLIC certificate in `INFERENCE_BROKER_CA_PEM`, with literal `\n` line breaks if supplied as one environment value. The broker client trusts that certificate only for its own HTTPS transport and still verifies the hostname and expiry. Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` or disable TLS checks. Renew and redistribute the public pin before this dedicated certificate expires.

Set `HUBERT_INFERENCE_HOST`, `HUBERT_PROXY_UID` and `HUBERT_PROXY_GID` for Compose interpolation, using the owner of the protected certificate files. Start with the base and overlay files. The TLS proxy uses host networking so the new socket follows host UFW rules; it has no published-port DNAT bypass. The broker remains loopback-only on 4100. Docker documents the [UFW interaction](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

Check the existing firewall before adding a narrowly scoped TCP 9443 allow rule for the intended caller. Do not reset/enable/reload UFW, change defaults, remove game/SSH rules, restart Docker, or start another project's stopped proxy. If interactive sudo is required, the operator performs that one firewall step privately. Verify the HTTPS endpoint using the trusted public certificate, first through an SSH tunnel if external ingress is still blocked.
