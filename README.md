# Hyper

Early-warning trading box: branches are weighed on a long/short scale, a confluence table of circles shows the tilt, and a voice speaks the verdict. Muse, Grok Bot, and other tools reach the same box through one MCP server with a sandbox API key.

You are either **Plan One** or **Plan Two**. Both people work in this one repository, in parallel, without waiting on each other.

- If you are person 1, open [plans/HYPER-PLAN-ONE.md](plans/HYPER-PLAN-ONE.md) and stay on branch `a/platform`. You own `server/` and `adapters/market/`.
- If you are person 2, open [plans/HYPER-PLAN-TWO.md](plans/HYPER-PLAN-TWO.md) and stay on branch `b/signal`. You own `adapters/indicators/`, `brain/`, `identities/`, and `web/`.
- Merge into `main` every 60 to 90 minutes. Do not edit the other person's files (see `CODEOWNERS`).

**Paper trading is the default.** There is no live-order path in this tree. A live order would need an explicit approval outside the MCP bearer token. Never commit secrets or `.env` values. Never invent an indicator reading: a branch with no data stays hollow.

## What is already in this repo

- `vendor/muse-inbox/` — sanitized copy of our Inbox app (no API keys). Copy the Zapier proxy, MCP auth, approvals, and `POST /api/messages` pattern from here. See [vendor/README.md](vendor/README.md).
- `vendor/ccxt` is **not** vendored as a full tree. CCXT is large. Install it as a dependency (`pip install ccxt`) and read the full source in:
  - upstream: https://github.com/ccxt/ccxt (MIT)
  - our fork: https://github.com/dailyfundeyt-crypto/ccxt
  - optional: `scripts/setup-ccxt.sh` adds the fork as a submodule
- Identity, brain, server, indicator, and web folders are the working tree you extend.

## Environment names only

Copy values in the Vercel UI from [muse-inbox-v3 environment variables](https://vercel.com/stefans-projects-e40bb777/muse-inbox-v3/settings/environment-variables). Never paste secrets into chat or into git.

The Vercel project for this box is named **Hyper**. Use the same names:

```
MCP_API_KEY=
ZAPIER_MCP_URL=
ZAPIER_MCP_TOKEN=
ELEVENLABS_API_KEY=
YOUTUBE_API_KEY=
EXCHANGE_ID=binance
```

`EXCHANGE_ID` selects the public CCXT venue for market data. The client is constructed without an API key or secret. It reads candles, tickers, and optional funding, open interest, and liquidations. It does not place orders.

## 60-second local demo

Paper only. This demo does not send an order.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export MCP_API_KEY=dev-local
export EXCHANGE_ID=binance
python -m server
```

`dev-local` is a stand-in you type in the shell for this demo. Do not commit it.

Open `http://127.0.0.1:8080/?key=dev-local` (or `http://127.0.0.1:$PORT/?key=dev-local` when `PORT` is set). The page asks for BTC bias, draws the circle table for `BTC/USDT`, and shows the spoken script. Play it with the Speak button. The browser `speechSynthesis` voice is used when `ELEVENLABS_API_KEY` is unset. Hollow circles mean that branch has no data.

If the venue returns an error, the price branches stay hollow and the detail shows that error. Binance answers 451 from some regions. Set `EXCHANGE_ID` to another public CCXT id, such as `kraken`, when you need candles. Still no API key, and still no order.

Call the same tool directly:

```bash
curl -s http://127.0.0.1:8080/mcp \
  -H "Authorization: Bearer dev-local" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_confluence","arguments":{"symbol":"BTC/USDT"}}}'
```

Auth accepts `Authorization: Bearer`, `x-api-key`, or `?key=`, checked against `MCP_API_KEY`. Health is `GET /health` and returns no secrets.

Run the tests (mocked CCXT, no exchange key):

```bash
python -m pytest -q
python scripts/check_secrets.py
```

## Layout

| Path | Who |
| --- | --- |
| `server/`, `adapters/market/` | Person 1, branch `a/platform` |
| `adapters/indicators/`, `brain/`, `identities/`, `web/` | Person 2, branch `b/signal` |
| `vendor/muse-inbox/` | Shared template. Do not put keys back into it. |
| `plans/` | The prompts each person pastes into their agent. |

Proxied Zapier tools are prefixed `zapier_`. `ZAPIER_MCP_URL` and `ZAPIER_MCP_TOKEN` stay in the server environment. Write, delete, outbound, and purchase calls need `message_id` and `approval_id`. `dry_run` does not execute them. The owner key is not accepted as the MCP bearer.
