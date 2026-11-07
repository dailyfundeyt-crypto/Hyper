# Hyper Plan One — Platform

You are person 1. Work on branch `a/platform`. You own `server/`, `adapters/market/`, Zapier proxy, Vercel, MCP auth, and heartbeat. Do not edit `web/`, `brain/`, `identities/`, or `adapters/indicators/`.

Paste each prompt below into your coding agent, in order. A step is done when the named files exist and person 2 can pull without broken imports.

## Goal

Ship an MCP gateway that Muse or Grok Bot can call with a sandbox API key. It serves market data through CCXT, proxies Zapier the Inbox way, and exposes confluence that Plan Two computes.

## Step-by-step

1. Create branch `a/platform` from `main`.
2. Confirm `ccxt` is a Python dependency. Do not copy the entire upstream tree into this repo.
3. Build `adapters/market/` around `fetch_ohlcv`, ticker, and optional funding, open interest, and liquidations. Missing data stays empty.
4. Build the MCP server with Bearer / `x-api-key` / `?key=` auth against `MCP_API_KEY`.
5. Copy the Inbox Zapier proxy from `vendor/muse-inbox/` (see `src/lib/zapier.ts` and `src/app/api/mcp/route.ts`). Prefix tools `zapier_`. Keep `ZAPIER_MCP_URL` and `ZAPIER_MCP_TOKEN` server-side only.
6. Add `POST /api/messages` like Inbox. Add a heartbeat near 30 minutes.
7. Wire `get_confluence` to Plan Two's indicator module when it lands on `main`.
8. Merge to `main` every 60 to 90 minutes.

## Prompts

P01: Create or confirm this repository layout and a README that states Hyper is an early-warning confluence MCP, paper-only by default, with no live orders.
P02: Add Python 3.11+, a pyproject or requirements file, and the dependency `ccxt`. Cite https://github.com/ccxt/ccxt and its MIT license in NOTICE. Also mention our fork https://github.com/dailyfundeyt-crypto/ccxt.
P03: Optionally add `scripts/setup-ccxt.sh` that can clone our fork as a git submodule under `vendor/ccxt` for reference only. Do not present upstream exchange connectors as our product code.
P04: Keep folders `server`, `adapters/market`, `adapters/indicators`, `brain`, `identities`, `web`, and `tests`.
P05: Confirm the README explains Plan One vs Plan Two and the two branches.
P06: Add `.env.example` with names only: `MCP_API_KEY`, `ZAPIER_MCP_URL`, `ZAPIER_MCP_TOKEN`, `ELEVENLABS_API_KEY`, `YOUTUBE_API_KEY`, `EXCHANGE_ID`.
P07: Keep branches `a/platform` and `b/signal`, protect `main` if possible, and merge every 60 to 90 minutes.
P08: Keep `CODEOWNERS` so One owns `server/` and `adapters/market/`, and Two owns `brain/`, `identities/`, `web/`, and `adapters/indicators/`.
P09: Add CI that lints and runs unit tests on each pull request. Fail if a secret-looking `.env` is committed.
P10: Document a Vercel project named Hyper. Env values are copied from muse-inbox-v3 settings, never from chat.
P11: Wrap ccxt `fetch_ohlcv` so it returns time, open, high, low, close, volume for a symbol and timeframe.
P12: Add `fetch_ticker` for last price and 24-hour change.
P13: Add `fetch_funding_rate` when the exchange supports it, otherwise return empty with a reason.
P14: Add `fetch_open_interest` when available, otherwise return empty with a reason.
P15: Try liquidations if ccxt exposes them for that venue. Never invent liquidation levels.
P16: Default to `BTC/USDT` and support `1h`, `4h`, and `1d`.
P17: Cache OHLCV in memory for about 30 seconds to respect rate limits.
P18: Turn adapter errors into an empty branch with the error string, not a guessed number.
P19: Write unit tests with a mocked ccxt client so no exchange API key is required.
P20: Expose MCP tool `get_ohlcv(symbol, timeframe, limit)`.
P31: Serve MCP over HTTPS JSON-RPC, following the Inbox protocol version where possible.
P32: Authenticate with Bearer, `x-api-key`, or a key query param against `MCP_API_KEY`.
P33: Add tool `get_confluence(symbol)` that returns each branch, a cited reason, and the long/short tilt. Call Plan Two's functions when they exist.
P34: Add tool `ask(text, identity)` that loads the matching `AGENT.md` written by Plan Two.
P35: Add tool `run_heartbeat` that refreshes market data and confluence.
P36: Add tool `list_identities`.
P37: Keep the sandbox free of live order placement and free of reading secret files.
P38: Stub an approval hook for any future stop or order, using the Inbox purchase class.
P39: Add a health endpoint that does not leak secrets.
P40: Add a local run command such as `python -m server`.
P41: Copy the muse-inbox Zapier proxy from `vendor/muse-inbox` so Hyper is an MCP client to Zapier.
P42: Prefix proxied tools with `zapier_` and cache the tool list for 60 seconds.
P43: Read `ZAPIER_MCP_URL` and `ZAPIER_MCP_TOKEN` only from server environment variables.
P44: Document that values are copied from the muse-inbox-v3 Vercel environment settings into Hyper.
P45: Add one new Zapier Zap description for Hyper alerts, reusing existing app connections instead of creating a parallel stack.
P46: Implement `POST /api/messages` with body `text` and optional `agent`, matching Inbox.
P47: Require `message_id` plus `approval_id` for write, delete, outbound, and purchase tools, and support `dry_run`.
P48: Keep the owner key out of the MCP bearer path.
P49: Support a flag URL that returns only A or B, or `WEBHOOK_URL`, to wake an agent on heartbeat.
P50: Add a test that the raw Zapier token never appears in MCP list or tool results.
P86: Add optional MCP tool `speak_confluence` that returns the script Plan Two generated.
P91: Wire the page to MCP so a heartbeat fills the table and then speaks.
P93: Add one YouTube or Zapier sentiment read if a key already exists; otherwise leave Sentiment hollow.
P94: Put a paper-only banner on the page and in the MCP instructions.
P95: Add a README section that explains the two branches and CODEOWNERS.
P96: Write a 60-second local demo path in the README.
P97: If submitting today, help record a pitch and demo of at most 3 minutes that shows the table, the voice, and an agent calling MCP.
P99: Merge to main and tag `v0.1-hackathon`.
