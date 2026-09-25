# sparkDash ⚡ — Multi-unit monitoring dashboard for NVIDIA DGX Spark

<p align="center">
  <img src="https://img.shields.io/badge/platform-arm64-2d9d78?style=flat-square" alt="Platform: ARM64">
  <img src="https://img.shields.io/badge/React-19-58c4dc?style=flat-square&logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express" alt="Express 5">
  <img src="https://img.shields.io/badge/license-MIT-2d9d78?style=flat-square" alt="MIT License">
  <br>
  <sub>by <a href="https://x.com/MiaAI_lab">Mia'a AI Lab</a></sub>
  <br><br>
  <a href="https://x.com/MiaAI_lab" target="_blank" style="display:inline-block;margin:0 8px;vertical-align:middle;"><img src="https://img.shields.io/badge/Follow%20me%20on%20X-000000?style=for-the-badge&logo=x&logoColor=white" alt="Follow Mia on X" height="28" style="height:28px;width:auto;vertical-align:middle;border:0;" /></a>
</p>

sparkDash is a real-time web dashboard for one or more **NVIDIA DGX Spark (GB10)** machines in a single browser window. It streams GPU, CPU, unified memory, storage, network, and local LLM metrics — and lets you add, edit, reorder, or remove Sparks from the UI without restarts or code changes.

It also supports **non-Spark units**: any Linux machine with an NVIDIA GPU (e.g. a workstation with a dedicated RTX/L-series card) can be added as a **dedicated GPU host** and monitored the same way via SSH and `nvidia-smi`. For these units the dashboard correctly separates **RAM** (system memory) from **VRAM** (discrete GPU memory).

## Production fork workflow

This fork lives at [virtualkevin/sparkDash](https://github.com/virtualkevin/sparkDash).
We keep our production changes as a small, reviewable commit stack on top of the
[MiaAI-Lab baseline](https://github.com/MiaAI-Lab/sparkDash):

- `origin` points to `virtualkevin/sparkDash`; `upstream` points to `MiaAI-Lab/sparkDash`.
- `main` tracks upstream `main`. Do not put deployment-specific changes on it.
- `production` contains our changes on top of `main`, including selected upstream
  PRs that have not yet merged. Make and commit local changes on this branch (or
  on feature branches based on it).
- Updating source does **not** deploy it. Building/restarting the running dashboard
  is a separate, explicit step. Keep host settings, credentials, and runtime data
  outside the tracked patch stack; preserve the dashboard's persistent config volume.

When adopting a new upstream baseline, start with a clean working tree and fetch
both remotes. If `upstream` is missing, add it once with
`git remote add upstream https://github.com/MiaAI-Lab/sparkDash.git`.

```bash
git fetch origin
git fetch upstream
git switch main
git merge --ff-only origin/main
git merge --ff-only upstream/main

git switch production
# Choose a unique backup name for each update; never overwrite an older backup.
git branch backup/production-before-rebase-YYYYMMDD-HHMM
git rebase main
```

If either fast-forward fails, inspect the divergent history rather than resetting
it. Before rebasing, reconcile any changes published to `origin/production` by
another contributor. Resolve rebase conflicts carefully, stage the resolved files,
and run `git rebase --continue`; use `git rebase --abort` to return to the old stack.
When upstream merges a carried PR, review whether its local commits can be dropped
as redundant; do not keep duplicate implementations.

Validate the rebased branch before deploying or publishing:

```bash
npm ci
npm run typecheck
npm test
npm run build
git diff --check main...production
```

When ready to publish, push `main` normally. The first production push is
`git push -u origin production`; after an intentional rebase of a published
production branch, coordinate with other contributors and use
`git push --force-with-lease origin production`, never an unconditional force push.
Do not push our production changes to MiaAI's upstream `main`.

### Carried changes

- [MiaAI-Lab/sparkDash PR #111](https://github.com/MiaAI-Lab/sparkDash/pull/111),
  **LLM token totals per model**, imported from Acermax's six commits through
  `10932231ab45ec9a946ecbcdabbd9929c94d7e08` using `git cherry-pick -x`.
  The initial baseline is `754f40a` (v1.8.8). Original authorship and source commit
  references are retained for future rebases. The Overview card is opt-in under
  **Settings → Show LLM Token Totals**. Its ledger now persists alongside energy in
  `config/fleet-energy.sqlite`; `llm-token-totals.json` (or `LLM_TOKEN_JSON_PATH`)
  is a one-time legacy import source. It records observed
  counter deltas, not historical traffic from before deployment.

### Initial validation (2026-09-24)

Validated in an isolated Node 22 container without access to the running dashboard
or inference services: locked dependency installation, typecheck, all 55 frontend
tests, and the production build passed. Server tests: 342/343 passed, including all
18 new ledger/format tests. The one failure, `integration splits energy and
coverage at UTC minute boundaries`, also reproduces on untouched `main` at
`754f40a`: its fixed 2026-08-23 fixture is pruned by the real-time 31-day retention
window. This pre-existing test-clock issue is not changed by the carried PR.

### Production energy efficiency and savings

Enable **Settings → Show Fleet Energy**, then enter the values under
**Electricity & API comparison prices**:

- A currency code (default USD; use the same currency for every rate).
- Electricity price per kWh.
- Uncached input, cached input, and output prices **per million tokens**.

Blank prices are unconfigured, not zero; an explicit zero means free. These
settings persist with the dashboard's existing settings file. They are one
comparison tariff for all observed models, not live provider rates or per-model
overrides. Changing rates recalculates history using the new rates; it does not
preserve historical tariffs or perform currency conversion.

The efficiency tile displays values like **0.179M / kWh**, using generated/output tokens:
`M tokens/kWh = 1 / (1000 × Wh/output-token)`. The Fleet Energy card also shows:

- **Electricity cost:** matched fleet kWh × electricity price/kWh.
- **Power / M output tokens:** electricity cost ÷ (generated tokens / 1,000,000).
  This includes prefill and idle electricity, not just decode power.
- **Equivalent API cost:** `((prompt − cached) × input price + cached × cached
  input price + generated × output price) / 1,000,000`. Cached tokens are a subset
  of prompt tokens and are never billed twice.
- **Savings after electricity:** equivalent API cost − electricity cost. Negative
  savings remain negative. Hardware, external cooling, taxes, and fees are excluded.

Cost estimates use **rolling 24-hour or 31-day matched intervals**, not lifetime
token totals mixed with a shorter power window. The card displays actual matched
hours. Each interval requires fresh whole-fleet power and exactly one monitored
head endpoint with valid cumulative input, cached-input, and output counters.
Idle power is included while that endpoint is observable. Missing telemetry,
unknown cache splits, counter resets/anomalies, endpoint/model changes, and long
sampling gaps are excluded rather than assumed free. Partially observed savings
are not a claim about unobserved hours or the whole electricity bill.

Matched accounting starts when this version is deployed; old energy/token totals
cannot safely reconstruct it. It persists with the minute buckets in the
fleet-energy SQLite database. Buckets prorate samples crossing minute boundaries;
rolling windows have sub-minute boundary approximation. A restart re-seeds live
counters without double counting. Back up the config volume before reverting to
an upstream-only build, which does not preserve these extra accounting fields.
All power is estimated from GPU/CPU telemetry, **not wall-metered**.

For vLLM, cached-input usage prefers `vllm:prompt_tokens_cached_total`, which
advances with prompt usage. `prefix_cache_hits_total` remains the diagnostic
hit-rate source and a best-effort fallback for older servers: scheduler hits
can arrive before prompt usage and are unsuitable for exact interval billing.
This corrects future accounting; historical cached/uncached classifications
are not automatically rewritten. The source change is included in local
production image rebuilds, and accumulated history persists in the config mount.

### Incremental energy and token storage (production)

The server uses `config/fleet-energy.sqlite` on Spark 1's local config bind
mount. It requires Node 22.13+ with `node:sqlite`; our image uses Node22.23.3 /
SQLite3.51.3. Node22 labels this API experimental; no separate database service
or additional native npm dependency is required.

- Live sampling remains every2 seconds; dirty state commits every30 seconds
  and on graceful shutdown. Dashboard response fields and refresh are unchanged.
- Each minute is a separate row. Only changed minutes, expired-row deletions,
  and small metadata/counter baselines are written, in one transaction. Completed
  history is not rewritten on every save. Retention remains31 days.
- WAL mode and `synchronous=FULL` keep committed transactions durable; an abrupt
  stop can still lose samples not yet committed (normally up to30 seconds).
  SQLite checkpoints automatically at1000 WAL pages and closes cleanly on exit.
- On first startup, existing `fleet-energy.json` is validated through the same
  tracker rules and imported transactionally. The original JSON is left unchanged
  and is never imported again once initialization commits. Corrupt databases,
  malformed import files, and unknown schema versions fail startup rather than
  silently discarding history. Existing tracker retention/scope rules still apply.
- Keep the database on local storage, not NFS. Run only one dashboard against
  the config directory. Database files are created mode0600.
- Token totals share this database and connection. Schema v2 adds separate rows
  for endpoint counter baselines, per-model lifetime totals, and per-UTC-day
  model totals. Only changed rows and retention deletions commit, atomically,
  every30 seconds while dirty and on graceful shutdown. Sampling remains15 seconds.
  Daily token history retains35 days; lifetime totals and API ranges are unchanged.
- `llm-token-totals.json` is imported once, before sampling starts, without
  rewriting it. Empty imports also record initialization, so a stale JSON file
  cannot later overwrite the database. Malformed imports fail startup. The
  pre-existing cached/uncached accounting issue is not retroactively repaired.
- Settings and daily **throughput-rate** summaries (`llm-daily.json`, distinct
  from daily token counts) remain in their existing small JSON files.

Before deployment, stop only the dashboard and back up its entire config
directory. For later backups, either stop the dashboard first and copy the
directory, or use SQLite's backup API; copying just the main database while it
is running can miss committed data in `-wal`. Never delete the WAL to save space.
The untouched legacy JSON is only the migration-time snapshot. Reverting to a
JSON-only image would use that stale snapshot: preserve a current SQLite backup
and export its latest state before a lossless rollback. Do not delete/reimport
the database as a routine restart action. Images predating schema v2 refuse the
upgraded database: use the pre-upgrade backup for a rollback (losing newer
samples), or export current data before a lossless downgrade.

Regression tests cover one-time migration, API snapshot equivalence, minute
rollover, token rebasing, retention, transaction rollback/retry, and SIGKILL
recovery. A synthetic full31-day history test measures60 steady-state saves;
WAL bytes and process write_bytes are reported separately, not claimed as SSD
NAND writes. Existing JSON persistence remains available in the tracker for
legacy tests; production server wiring always selects SQLite.

This change also fixes the pre-existing energy test's clock to match its fixture;
the PR import above remains intact as separate commits for rebasing.
Validation: 366 server tests and 61 frontend tests pass, along with typechecking
and the production build. Vite reports a non-blocking 500 kB chunk-size warning.

### Local production deployment (Spark 1)

Run from this fork's checkout on the `production` branch:

```bash
docker compose -f compose.production.yaml build
docker compose -f compose.production.yaml up -d --no-build
```

This serves port **5555** from our local source, not from a remote image or uvx.
It preserves the existing non-root, capability-dropped bridge-network deployment
and SSH-based collection on all four Sparks. The live config/history remains at
`../sparkdash/config` (override with `SPARKDASH_CONFIG_DIR`); the SSH key defaults
to `/home/nvidia/.ssh/id_ed25519_shared` (`SPARKDASH_SSH_KEY` overrides it).
Existing tokenless LAN access is unchanged. Do not use the upstream default
Compose file, which grants privileged host access. No inference container is
managed by this Compose project. Code edits require a rebuild/recreate.

Before replacing the dashboard, stop only `sparkDash` and back up its config
directory with restricted permissions. Retain the prior image for rollback.
Never run old and new dashboards concurrently against the same config directory.

<img src="./assets/screenshot.jpg" alt="sparkDash Overview page with multiple DGX Spark units, GPU metrics, and LLM status">

### LLM Prompt Showcase

<a href="https://github.com/MiaAI-Lab/sparkDash/releases/download/media-showcase/llm-showcase.mp4">
  <img src="./assets/llm-showcase.gif" alt="LLM Prompt Showcase — multi-terminal streaming demo (click for MP4)" width="100%">
</a>

<p align="center"><sub><a href="https://github.com/MiaAI-Lab/sparkDash/releases/download/media-showcase/llm-showcase.mp4">Download MP4</a> · also in <code>assets/llm-showcase.mp4</code></sub></p>

---

## Table of contents

- [Production fork workflow](#production-fork-workflow)
- [Latest version changelog](#latest-version-changelog)
- [Features](#features)
- [ComfyUI monitoring](#comfyui-monitoring)
- [Hermes Agent monitoring](#hermes-agent-monitoring)
- [Tailnet monitoring](#tailnet-monitoring)
- [Full changelog](./CHANGELOG.md)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [REST API](#rest-api)
- [Configuration](#configuration)
- [Security](#security)
- [Scripts](#scripts)
- [How it works](#how-it-works)
- [Contributing](#contributing)
- [License](#license)

---

## Latest version changelog

### Version 1.8.8 — SGLang live tok/s
- **Overview tok/s on SGLang** follows `gen_throughput` while a request is running. The completion counter on current builds only moves when the request finishes, so the card stayed at 0 for the whole decode.

Full history: [CHANGELOG.md](./CHANGELOG.md)

---

## Features

| Area | What you get |
|------|----------------|
| **Multi-unit** | Any number of units; each has a tabbed detail page plus a shared Overview |
| **Non-Spark GPU hosts** | Linux boxes with a dedicated NVIDIA GPU are first-class units: same `nvidia-smi` collectors over SSH, detected hardware summary, and separate **RAM** / **VRAM** panels. Detail page: GPU (left) + **RAM → Network → Storage** (right column); Overview cards show RAM and VRAM bars |
| **Live streaming** | WebSocket metrics with configurable poll intervals; central history store for sparklines across tab switches |
| **Local + remote** | Host metrics via sysfs/proc/`nvidia-smi`; remotes over SSH (key or password) |
| **LLM probe** | Auto-detects llama.cpp, vLLM, sglang, ds4-server, EXL3, or q27; live decode/prefill tok/s; cached vs uncached prefill on ds4, llama.cpp, SGLang, and q27; **daily peak** history on the LLM card |
| **ComfyUI** | Opt-in probe: queue/jobs, progress, cancel, Open link, inventory, overview chip |
| **Hermes Agent** | Opt-in per unit: background update check (10 min), status badges, one-click or batch `hermes update` |
| **Tailnet** | Opt-in probe: flags a unit that is healthy on the LAN but off its tailnet |
| **Decode benchmark** | Multi-concurrency streaming decode tok/s; type picker (Structured / Prose / Code / JSON). Code is a different Python task per stream. Lab protocol (temp 0, thinking off); persisted last run. Remote units: LAN HTTP, or SSH tunnel to loopback. **Remote** button for an on-demand HTTPS/host:port target |
| **Prefill benchmark** | Context-size sweep (1k–300k) of prefill tok/s and TTFT; unique prefix per size; persisted last run. Same remote targeting as decode |
| **Prompt Showcase** | Full-page multi-terminal LLM streaming demo (up to 32 prompts) with live tok/s and copy-out |
| **LLM inference health** | KV cache %, run/wait queue, TTFT/E2E/ITL p95, preemptions, prefix cache, MTP accept from Prometheus `/metrics` (vLLM and q27; q27 FIFO-queues so the Requests tile reads “N run” without a wait gauge) |
| **Multiple LLM ports** | Monitor several LLM servers on different ports simultaneously — each gets its own panel with independent backend detection and metrics |
| **GPU processes** | See the top GPU processes by VRAM usage directly in the GPU panel, including process name and memory allocation |
| **Spark uptime** | System uptime displayed inline on each Spark header for at-a-glance availability |
| **Power controls** | Graceful shutdown (SSH host script) and Wake-on-LAN; batch actions on Overview |
| **Spark roles** | **Head** / **Worker** / **Standalone** — worker label + head link; standalone can disable LLM monitoring; optional hide workers from Overview and tabs |
| **Unified memory** | GB10 128 GB LPDDR5X pool (~273 GB/s), GPU/CPU split, bandwidth via `nvidia-smi dmon`. Non-Spark hosts show discrete **VRAM** (nvidia-smi) and system **RAM** separately |
| **Themes** | Dark, light, cool white, OLED — neutral palettes, persisted in `localStorage` |
| **Secrets** | SSH passwords AES-256-GCM encrypted; never in `sparks.json` or API responses |
| **Docker-first** | Single privileged container for host metrics; prod and dev Compose files |
| **Hot config** | Add / edit / remove / reorder Sparks from the UI with no process restart |

---

## ComfyUI monitoring

sparkDash can **optionally** monitor a [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance on each Spark — the same way it probes local LLMs, but focused on **jobs and queue**, not a second copy of GPU/RAM bars (those stay on the GPU / CPU panels).

### What is supported

| Capability | Details |
|------------|---------|
| **Opt-in per Spark** | `comfyMonitoring` (default **off**) + `comfyPort` (default **8188**) |
| **Any role** | Head, worker, and standalone can enable ComfyUI independently of LLM cluster role |
| **Liveness** | `GET /system_stats` — online, ComfyUI / PyTorch version, device type (cpu/cuda) |
| **Queue / jobs** | `GET /queue` — running + pending items; workflow **title**, **model/LoRA** filenames from the graph, footprint (**resolution · steps · sampler · batch · node count**) |
| **Progress** | Progress bar on the active job — Comfy WebSocket when events are available; otherwise elapsed / average-duration **estimate** |
| **Last finished job** | Status + duration via `/api/jobs` (fallback `/history`) |
| **Queue ETA** | Estimate from recent job durations × pending (+ progress remainder when known) |
| **Cancel / remove** | From the Comfy card: interrupt a running job or dequeue a pending one (`POST /api/sparks/:id/comfy/cancel`) |
| **Open ComfyUI** | One-click link to `http://{lanIp}:{comfyPort}` (LAN IP preferred so remote browsers do not hit localhost) |
| **Model inventory** | Checkpoints + LoRAs from `/models/*` (UI section only when at least one file is listed) |
| **Overview chip** | When monitoring is on: `Comfy · idle` / `run` / `Nq` / muted if unreachable |
| **Layout** | Under **Services**: primary LLM + Comfy side-by-side when both are enabled; collapsible **Resources** / **Services** sections |

**Not claimed:** true per-job VRAM (Comfy does not expose that cleanly over HTTP). Host GPU/VRAM remains on the GPU panel. Live step progress depends on Comfy broadcasting WS events; stock Comfy often scopes detailed progress to the client that submitted the prompt.

### How to enable (per Spark)

1. Open the Spark tab → **Edit** (pencil).
2. Enable **ComfyUI monitoring**.
3. Set **port** if needed (default **8188**).
4. **Save**.

The Spark page **Services** section shows the ComfyUI card. On Overview, a small Comfy chip appears for that unit.

**Connectivity Test** (in Edit) includes ComfyUI when monitoring is enabled.

### ComfyUI side requirements

- ComfyUI must be reachable from the **sparkDash server** on the probe host:
  - **Local Spark** (`isLocal`): sparkDash probes `127.0.0.1:{port}` (use Docker `network_mode: host` if the dashboard runs in a container).
  - **Remote Spark**: probe uses the Spark **LAN IP** (same as LLM probes).
- For **Open** from another machine’s browser, Comfy should listen on a reachable interface (e.g. `--listen 0.0.0.0`), not only loopback, and the Spark’s **LAN IP** must be set correctly in Edit.

### Config fields (persisted on the Spark)

| Field | Default | Description |
|-------|---------|-------------|
| `comfyMonitoring` | `false` | Probe ComfyUI and show the card / overview chip |
| `comfyPort` | `8188` | ComfyUI HTTP port |

### Related API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/sparks/:id/comfy/cancel` | Cancel a job (`{ "promptId": "<uuid>" }`) — interrupt running and/or remove from queue |

Env (optional): `COMFY_PORT` (default `8188`), `COMFY_PROBE_TIMEOUT_MS`, `POLL_INTERVAL_COMFY`.

---

## Hermes Agent monitoring

sparkDash can **optionally** monitor [Hermes Agent](https://github.com/nousresearch/hermes-agent) (nousresearch/hermes-agent) on each unit and run one-click updates for you over SSH.

### What is supported

| Capability | Details |
|------------|---------|
| **Opt-in per Spark** | `hermesMonitoring` (default **off**) in **Edit Spark** |
| **Auto update check** | Background `hermes update --check` over SSH (default every 10 min) — returns update availability + pending commits |
| **Status badges** | In the Spark header: `Hermes` (installed version), `Hermes not found` if the binary is missing |
| **One-click update** | **Update Hermes** button opens a dialog with live status, real pending commits, and release notes; **Update now** runs `hermes update` via SSH (non-interactive go) |
| **Update state** | Running / success / error surfaced live (button turns into a “Hermes updating… / failed” state) |
| **Batch update** | **Update Hermes** on Overview runs `hermes update` on every monitored unit, with a live per-unit progress bar |

### How to enable (per Spark)

1. Open the Spark tab → **Edit** (pencil).
2. Enable **Hermes Agent**.
3. **Save** — background checks start immediately.

The **Update Hermes** button appears in the Spark header/mobile action row; it turns warning-yellow with a commit-count badge only when an update is actually available. It also appears on Overview (batch) when at least one unit has Hermes enabled.

**Connectivity check note:** local units run the check as the **host user** (via `setpriv`/`nsenter`, never as container root); remote units run it over SSH. Either way, the logged-in user needs permission to read the Hermes repo.

### Side requirements

- **Hermes Agent must be installed on the target machine** — sparkDash only checks & updates; it does not install it. The binary is looked up in `~/.local/bin` and `/usr/local/bin`.
- SSH user must be able to run `hermes update --check` / `hermes update` non-interactively (key auth recommended).
- An update can take a few minutes (repo pull + dependency reinstall); a stale `*.lock` file from a crashed run is cleared before each attempt.

### Config fields (persisted on the Spark)

| Field | Default | Description |
|-------|---------|-------------|
| `hermesMonitoring` | `false` | Check/update Hermes Agent on this machine |

### Related API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/sparks/hermes/update-all` | Batch `hermes update` on every monitored Spark (Overview button) |
| POST | `/api/sparks/:id/hermes/check` | Force `hermes update --check` now |
| POST | `/api/sparks/:id/hermes/update` | Run `hermes update` in the background (202) |
| GET | `/api/sparks/:id/hermes/updates` | Update preview: latest release + installed version + real pending commits + resolved view |

Env (optional): `POLL_INTERVAL_HERMES` (default `600000` ms), `HERMES_UPDATE_TIMEOUT_MS` (default `600000` ms).

---

## Tailnet monitoring

Opt-in per unit (default **off**). Runs `tailscale status --json` on the host and shows a **Tailnet** card under Resources.

This closes a blind spot every LAN-based check shares, including sparkDash's own SSH liveness. When `tailscaled` loses its session with the coordination server, SSH/GPU/LLM can all stay healthy while the box is unreachable from off-LAN.

### What is supported

| Capability | Details |
|------------|---------|
| **Opt-in per unit** | `tailscaleMonitoring` (default **off**) in **Edit Spark** |
| **Off-tailnet detection** | `Self.Online` — the node's *own* view of the coordination server |
| **Reason, not just state** | Tailscale `Health` messages, backend state, tailnet IP, DERP relay, version, expired-key warning |

Asked of **each node about itself**. Peer state is never the verdict. The probe is read-only (`tailscale up` / `down` / `login` are never run).

### How to enable

1. Open **Edit Spark**.
2. Tick **Tailnet monitoring**.
3. Save. The Tailnet card appears under Resources.

### Host requirements

- `tailscale` CLI on the monitored host, and `tailscaled` running.
- Remote units: existing SSH. Local Docker: `nsenter` into the host mount namespace (same as `nvidia-smi`; `/host/proc` is already bind-mounted).

### Config fields

| Field | Default | Description |
|-------|---------|-------------|
| `tailscaleMonitoring` | `false` | Run `tailscale status --json` and show the Tailnet card |

Env (optional): `POLL_INTERVAL_TAILSCALE` (default `30000`), `TAILSCALE_PROBE_TIMEOUT_MS` (default `8000`).

---

## Quick start

```bash
git clone https://github.com/MiaAI-Lab/sparkDash.git
cd sparkDash

# Production (Docker; loopback-only by default)
docker compose up --build -d

# Or development (host, with hot reload)
npm install
npm run dev
```

- **Docker**: open **http://127.0.0.1:5555** on the host (arm64 image, auto-restart, host mounts for GPU/metrics access)
- **Dev**: Vite on **http://localhost:5173** (proxies API/WS to Express)

For another computer, keep the server on loopback and use an SSH tunnel:

```bash
ssh -N -L 5555:127.0.0.1:5555 user@sparkdash-host
```

Then open `http://127.0.0.1:5555` on that computer. For shared access, use an authenticated TLS reverse proxy, Tailscale Serve, or set `BIND_HOST=0.0.0.0` **and** `SPARKDASH_TOKEN`. Direct LAN bind without a token fails closed. Previous `http://<host-ip>:5555` installs must migrate.

For development with Docker (source-mounted, HMR):
```bash
docker compose -f docker-compose.dev.yml up --build
```

**Remote units + SSH keys (Docker):** SSH is executed *inside* the container on the sparkDash host (typically the head DGX). Configured LAN IPs are from **that** host’s point of view, not your laptop. OpenSSH looks for keys under `/root/.ssh` in the container — the host user’s `~/.ssh` is not used unless you bind-mount it. Uncomment this volume in `docker-compose.yml` (and recreate the container):

```yaml
- ${HOME}/.ssh/id_ed25519:/root/.ssh/id_ed25519:ro
```

If the key file has a non-default name (e.g. `id_ed25519_shared`), mount it **as** `id_ed25519`, or set `SSH_IDENTITY_FILE` to the path inside the container. Keep the file mode `600`. The unit that runs sparkDash itself should be added with **This host (local collectors — no SSH for metrics)**.

---

## Architecture

Design principle: **one Spark model, N instances**. Every unit is a record in `config/sparks.json` with a `kind` field (`spark` or `host`). The same `SparkMonitor`, `SystemCollector`, and `LlmProbe` code runs for all of them. Adding a unit is a config change, not a code change.

```txt
┌────────────────────── Docker container (sparkDash) ────────────────────────┐
│  Express (server/)                                                         │
│  ├─ config/sparks.json        Spark registry (API read/write)              │
│  ├─ SparkRegistry             load/persist Sparks; change events           │
│  ├─ SparkMonitor (per Spark)  collector + LLM probe + rate baselines       │
│  │   ├─ SystemCollector       local sysfs/proc OR remote SSH               │
│  │   └─ LlmProbe              HTTP to host:LLM_PORT, backend autodetect    │
│  ├─ REST /api/*                                                            │
│  └─ WebSocket /ws             snapshot stream to browsers                  │
│  React SPA (src/)  — Overview + per-Spark pages, themes, dialogs           │
└────────────────────────────────────────────────────────────────────────────┘
         │ SSH (key or sshpass)                    │ HTTP :8888
         ▼                                         ▼
    remote Spark(s)                         each Spark’s LLM server
```

### Data flow

```txt
Browser  ←→  WebSocket /ws   ←→  SparkMonitor.snapshot()  ←→  collectors
Browser  ←→  REST /api/*     ←→  SparkRegistry + SparkMonitor
```

Poll loops run in the background (even with no clients) so rate metrics — tokens/s, network bytes/s, disk I/O — stay correct.

---

## Tech stack

| Layer | Stack |
|-------|--------|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS v4 |
| Backend | Node.js (ESM), Express 5, `ws` |
| Platform | ARM64 — DGX Spark GB10 (Neoverse V2) |
| Deploy | Docker multi-stage (arm64), Compose |
| Secrets | AES-256-GCM SSH password store |
| Ports | **5555** dashboard/API; **5173** Vite (dev only) |

---

## Repository layout

```txt
sparkDash/
├── src/                 React + TypeScript SPA
│   ├── api/             REST client + shared types
│   ├── components/      Overview, Spark pages, dialogs, UI primitives
│   ├── hooks/           WebSocket snapshot, routing
│   └── theme / CSS      Tailwind v4 + four themes
├── server/              Express + WebSocket (plain JS ESM)
│   ├── sparks/          SparkRegistry, SparkMonitor
│   ├── collectors/      SystemCollector, LlmProbe, ssh
│   ├── secretsStore.js  Encrypted password persistence
│   └── validate.js      Host/user validation (SSRF-minded)
├── config/              Runtime state (volume; secrets gitignored)
├── assets/              Screenshots
├── Dockerfile           Production multi-stage arm64
├── docker-compose.yml   Production
├── docker-compose.dev.yml
└── deploy.sh            Rebuild / recreate helpers
```

---

## REST API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sparks` | List Sparks (passwords redacted) |
| POST | `/api/sparks` | Add Spark and start its monitor |
| PATCH | `/api/sparks/:id` | Update Spark (hot-swap config) |
| DELETE | `/api/sparks/:id` | Remove Spark and drain monitor |
| PUT | `/api/sparks/order` | Persist tab order |
| GET | `/api/sparks/:id/metrics` | One-shot metrics snapshot |
| GET | `/api/fleet-energy` | Estimated fleet watts, rolling energy, coverage, and Wh/output-token |
| POST | `/api/sparks/test` | Ephemeral SSH + LLM (+ Comfy if enabled) test (no persist) |
| POST | `/api/sparks/:id/test` | Connectivity test (can save password) |
| POST | `/api/sparks/:id/comfy/cancel` | Cancel ComfyUI job by `promptId` |
| PUT | `/api/sparks/:id/password` | Save SSH password (works offline) |
| PUT | `/api/sparks/:id/disabled-devices` | Hide storage devices (hot) |
| PUT | `/api/sparks/:id/disabled-interfaces` | Hide network interfaces (hot) |
| PUT | `/api/sparks/:id/llm-ports` | Replace all LLM ports (hot) |
| POST | `/api/sparks/:id/llm-ports` | Add an LLM port (hot) |
| DELETE | `/api/sparks/:id/llm-ports/:port` | Remove an LLM port (hot) |
| PUT | `/api/sparks/:id/llm-port` | LLM port — backward-compat (hot) |
| GET | `/api/sparks/:id/llm/daily` | Daily busy decode/prefill tok/s (`port`, `days`) |
| POST | `/api/sparks/:id/llm/bench` | Start decode benchmark (202); poll/cancel/clear on the same path |
| POST | `/api/sparks/:id/llm/prefill-bench` | Start prefill + TTFT context sweep (202); poll/cancel/clear on the same path |
| GET | `/api/settings` | Global settings |
| PUT | `/api/settings` | Update global settings |
| WS | `/ws` | Real-time metrics stream |

There is no application authentication on the HTTP/WebSocket API. sparkDash therefore binds to loopback and refuses direct LAN binding. Use an SSH tunnel, authenticated TLS reverse proxy, or Tailscale Serve; see [Remote access](./docs/REMOTE-ACCESS.md).

`/api/fleet-energy` samples the configured fleet independently every two seconds. It estimates
each node as GPU board draw + a CPU utilization model (5.2–65 W) + 23 W of memory/network/base
overhead, clamped to the DGX Spark power envelope. Current and hourly fleet watts require fresh,
simultaneous telemetry from every node; coverage fields make gaps explicit. Minute buckets are
persisted at mode `0600` for rolling 24-hour and 31-day windows. Wh/output-token is reported when
exactly one configured node has role `head` and exposes a monotonic LLM output-token counter.
These values are estimates, not wall-meter measurements. Restart sparkDash after changing fleet
membership so the persisted series has one stable node set.

---

## Configuration

### Global settings (UI or API)

Gear icon in the header, or `GET`/`PUT` `/api/settings`:

| Setting | Default | Description |
|---------|---------|-------------|
| Poll interval | 2000 ms | WebSocket broadcast interval (minimum 1000 ms) |
| Default LLM port | 8888 | Default for new Sparks |
| Auto-hide offline | false | Hide offline Sparks on Overview |
| Hide worker nodes | false | Hide Worker-role Sparks from Overview and the tab bar |
| Temperature unit | Celsius | Display GPU temperature in °C or °F |
| Benchmark share image | true | Decode/prefill **Copy results** becomes a split button: the label copies the text summary, the caret offers **Copy as text** / **Copy as image** on hover or click. Turn it off to keep the plain button. The image copies where the page has an image clipboard (HTTPS or localhost); over plain http on a LAN IP the card downloads instead |

### Environment variables

Copy `.env.example` to `.env` if needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `BIND_HOST` | `127.0.0.1` | HTTP and WebSocket listen address. Non-loopback bind requires `SPARKDASH_TOKEN`. |
| `SPARKDASH_TOKEN` | _(empty)_ | Bearer token required for mutations and remote telemetry when not on loopback. |
| `PORT` | `5555` | HTTP + WebSocket listen port |
| `LLM_PORT` | `8888` | Default LLM probe port |
| `COMFY_PORT` | `8188` | Default ComfyUI probe port |
| `POLL_INTERVAL_GPU` | `2000` | GPU poll (ms) |
| `POLL_INTERVAL_COMFY` | `2000` | ComfyUI probe poll (ms) |
| `POLL_INTERVAL_CPU` | `2000` | CPU / RAM poll (ms) |
| `POLL_INTERVAL_NETWORK` | `2000` | Network poll (ms) |
| `POLL_INTERVAL_STORAGE` | `5000` | Storage poll (ms) |
| `POLL_INTERVAL_LLM` | `2000` | LLM probe poll (ms) |
| `POLL_INTERVAL_BANDWIDTH` | `2000` | Memory bandwidth / dmon poll (ms) |
| `POLL_INTERVAL_HERMES` | `600000` | Hermes Agent update check poll (ms) |
| `POLL_INTERVAL_TAILSCALE` | `30000` | Tailnet probe poll (ms) |
| `TAILSCALE_PROBE_TIMEOUT_MS` | `8000` | Timeout for `tailscale status --json` (ms) |
| `POLL_INTERVAL_NVERR` | `60000` | Kernel journal scan for NVRM `NV_ERR_NO_MEMORY` (ms) |
| `HERMES_UPDATE_TIMEOUT_MS` | `600000` | Hard timeout for running `hermes update` over SSH (ms) |
| `POLL_INTERVAL_LIVENESS` | `5000` | Online/SSH liveness check (ms) |
| `SPARKDASH_SECRETS_KEY` | _(auto)_ | Passphrase or 64-char hex for secret encryption |
| `HOST_PROC_PATH` | `/host/proc` | Host proc mount inside container |
| `HOST_SYS_PATH` | `/host/sys` | Host sys mount |
| `HOST_ROOT_PATH` | `/host/root` | Host root mount |
| `SSH_IDENTITY_FILE` | _(unset)_ | Path **inside the process** to a private key (`ssh -i`). Use when the bind-mount is not a default OpenSSH name. |
| `SSH_CONTROL_PERSIST_SECONDS` | `60` | Reuse authenticated SSH transports for remote collectors. Set to `0` to disable multiplexing. |
| `FLEET_ENERGY_JSON_PATH` | `config/fleet-energy.json` | Legacy energy JSON import source |
| `FLEET_ENERGY_SQLITE_PATH` | Legacy path with `.json` replaced by `.sqlite` | Incremental energy database on local storage |

> The listener and both Compose files default to `127.0.0.1`. Existing Docker users who opened
> `http://<host-ip>:5555` must migrate to an SSH tunnel, authenticated reverse proxy, Tailscale
> Serve, or `BIND_HOST=0.0.0.0 SPARKDASH_TOKEN=...`. Recovery:
> `BIND_HOST=127.0.0.1 docker compose up -d --force-recreate`.

### Adding a unit

1. Open the **+** tab.
2. Choose **Unit type**:
   - **NVIDIA DGX Spark** — the default; hardware summary shows DGX Spark specs and the CX7 IP field is available.
   - **Dedicated GPU host** — any Linux machine with an NVIDIA GPU. It is monitored exactly like a Spark (SSH + `nvidia-smi`) but is **not** reported as a DGX Spark: the header shows a detected hardware summary (GPU model, CPU, RAM) instead of fixed GB10 specs, and the page shows separate **RAM** and **VRAM** panels (VRAM from `nvidia-smi`, RAM from system memory). On the unit page, RAM → Network → Storage stack in the right column with GPU filling the left column.
3. Set **Name** and choose whether this is **This host**. Local units do not require a LAN IP or SSH; their optional LAN IP enables browser links and directed Wake-on-LAN. Remote units require a LAN IP/host, SSH user, and key or password. Key auth in Docker needs a key mounted into the container (see Quick start).
4. **Test** shows pass/fail/skipped for host collectors/SSH and each enabled service (LLM, ComfyUI, Hermes Agent, Tailnet). Every enabled capability must pass; disable an unavailable optional service before saving if it should not be monitored.
5. Save — a tab appears and metrics start streaming.

### Power controls (shutdown / Wake-on-LAN)

- **Shutdown** (per Spark or **Shutdown All** on Overview) runs over SSH:  
  `sudo -n /usr/local/bin/spark-shutdown`  
  Install that script on each Spark and allow passwordless sudo for it only.
- **Wake** / **Wake All** send a UDP magic packet (port 9). The MAC is taken from the **enP7s7** interface automatically while the Spark is online (persisted as `detectedMacAddress`). Optionally set a **MAC override** in Edit Spark. Broadcast is derived as `/24` from LAN IP, or `255.255.255.255` if LAN IP is missing.
- Batch shutdown only targets **online** Sparks; offline nodes are skipped.
- Power APIs are mutations: on loopback they follow the local-trust model; a remote bind requires `SPARKDASH_TOKEN`.

### Themes

Header theme control cycles:

| Theme | Notes |
|-------|--------|
| **Dark** (default) | Neutral grays, true black base, muted amber accent |
| **Light** | Warm paper whites |
| **White** | Cool neutral whites |
| **OLED** | True black for OLED panels |

Choice is stored in `localStorage`.

---

## Security

- **SSH passwords** are not stored in `sparks.json` and are never returned by the API.
- Passwords are encrypted with **AES-256-GCM** in `config/sparks-secrets.json` (survives restarts).
- Encryption key: `config/.secrets-key` (auto-generated) or `SPARKDASH_SECRETS_KEY`. **Do not delete the key file** or encrypted secrets become unreadable.
- **Target validation** rejects clearly unsafe IPv4 targets (link-local `169.254.0.0/16`, `0.0.0.0/8`, multicast/reserved ≥ 224). Private, loopback, and public addresses are allowed so LAN and remote Sparks work.
- SSH and HTTP probes use short timeouts (about 5 s SSH connect, 3 s HTTP) so a hung host cannot stall the poll loop.
- Prefer **SSH keys** over passwords. In Docker, mount the private key into `/root/.ssh` (see Quick start); passwords are the only SSH secret the app stores itself.
- Loopback installs remain local-trust. Remote bind (`BIND_HOST` not loopback) requires `SPARKDASH_TOKEN` for mutations and WebSocket telemetry and fails closed without it.
- One-off remote benchmark hosts must be listed in `SPARKDASH_BENCH_HOSTS`.
- Tested operator capacity for this remediation: **12 units**.


---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite (5173) + Express (5555) together |
| `npm run dev:server` | Express only (`node --watch`) |
| `npm run dev:client` | Vite only |
| `npm run build` | Production frontend → `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm start` | Production server (`node server/index.js`) |
| `npm run docker:up` | `docker compose up -d` |
| `npm run docker:prod` | Same as `docker:up` |
| `npm run docker:rebuild` | `docker compose up --build -d` |
| `npm run docker:dev` | Dev Compose |
| `npm run docker:dev:build` | Dev Compose with rebuild |
| `./deploy.sh` | Recreate container; `--build`, `--frontend` flags |

---

## How it works

### Local vs remote Sparks

One `SystemCollector` path for both modes. When `spark.isLocal` is true, metrics come from host sysfs/proc and `nvidia-smi` (often via nsenter into the host namespace). Remote Sparks wrap the same commands in a shared `sshExec()` helper (key agent or `sshpass`). The helper reuses an authenticated OpenSSH transport by default so frequent metric polls do not create a new SSH/PAM login lifecycle each time. Set `SSH_CONTROL_PERSIST_SECONDS=0` to disable reuse. For `kind: "host"` units, actual hardware (GPU model, driver version, CPU, RAM) is detected once and cached in place of the static DGX Spark specs, and GPU VRAM comes straight from `nvidia-smi` while system RAM is read from `/proc/meminfo`.

### Graceful degradation

Collectors catch errors and return zero/default metrics instead of crashing the loop. After sustained liveness failures, a Spark is marked offline; the UI shows stale or empty states rather than hard errors.

### Hot configuration

Name, IP, SSH credentials, LLM port, and device/interface filters update the running `SparkMonitor` without tearing down poll loops or losing rate baselines. Registry writes are atomic (temp file + rename).

### LLM probe

Each configured LLM port gets its own `LlmProbe` instance running in parallel. Probes auto-detect backends:

- **llama.cpp** — `/slots` for live decode rates; model from `/props`
- **ds4-server** (Entrpi/ds4-on-spark) — `/v1/models` (`owned_by: ds4.c`) + Prometheus `ds4_*` token counters for live tok/s
- **EXL3** (ExLlamaV3 `tools/serve_openai.py`) — `/v1/models` (`owned_by: exl3`) or `/health` `{ok, busy}`; live tok/s from `/health` cumulative counters
- **q27** (signalnine/q27 engine) — `/v1/models` (`owned_by: q27`) or Prometheus `q27_*` series; live tok/s from `q27_*_processed` counter diffs (completion-based totals as fallback), exact computed-only prefill with the cached/uncached split doubling as the prefix-cache hit rate, TTFT/E2E/ITL p95 histograms, and constant-0 preemptions (FIFO admission, no wait queue)
- **vLLM / sglang** — `/v1/models`; sglang via `/server_info` (`last_gen_throughput` when metrics off; `/get_server_info` fallback), vLLM via Prometheus `/metrics` counters (scientific notation supported)

Rates are derived from per-probe cumulative counter diffs (or SGLang sticky throughput while it moves). Multiple ports can be added or removed at runtime without restarting the monitor.

Live probes still use the LAN IP on remote units. **Decode and prefill benches** try that same HTTP target first; if it is closed they open an SSH local-forward onto the remote’s `127.0.0.1` so loopback-bound servers (ds4 `start.sh` default) can still be measured. The tunnel is torn down when the job finishes or is cancelled.

---

## Contributing

Contributions are welcome. Conventions:

- **Server**: plain JavaScript ESM
- **Client**: TypeScript + React
- Prefer extending the shared Spark model over per-unit special cases

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Mia'a AI Lab

---

## Acknowledgements

- Built for the **NVIDIA DGX Spark (GB10)** on ARM64
- Rebuilt from a legacy multi-unit dashboard with a single shared Spark model (no copy-pasted “Spark N” code paths)
- LLM probe behavior refined from production monitoring experience
