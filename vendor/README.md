# Vendor

## Muse Inbox is the template

`vendor/muse-inbox/` is a sanitized copy of our Inbox app so person 2 can work without that app checked out locally. It contains no API keys. A bridge key file that arrived inside the archive (`pc-bridge/.pc-key`) was deleted before this tree was committed. Do not add it back. Do not add `.env` values, owner keys, or flag URLs.

Copy these patterns into Hyper. Leave the Inbox files as the reference:

| Pattern | Where it lives in the Inbox copy |
| --- | --- |
| MCP bearer auth (`Authorization`, `x-api-key`, `?key=`) | `src/lib/auth.ts`, `src/app/api/mcp/route.ts` |
| Zapier MCP proxy | `src/lib/zapier.ts` |
| Tool prefix | `zapier_` in `src/lib/zapier.ts` (`ZAPIER_PREFIX`) |
| Tool-list cache | 60 seconds inside `listZapierTools` |
| Write guard | `message_id` + `approval_id`, plus `dry_run` |
| `POST /api/messages` | `src/app/api/messages/route.ts` — body `text`, optional `agent` |

`ZAPIER_MCP_URL` and `ZAPIER_MCP_TOKEN` are read only from the server environment. Hyper's proxy is `server/zapier_proxy.py`. It follows the same prefix, cache, and approval shape, and it strips those secret values from tool lists and tool results.

One Zapier Zap is enough for Hyper alerts: reuse the app connections already used by Inbox. The Zap fires when a heartbeat says the spoken bias flipped. It sends a message through the existing inbox path. It does not open a second Zapier account, and it does not place an order.

## CCXT is not in this folder

Do not copy the CCXT source tree into `vendor/`. Install the Python package (`ccxt` in `requirements.txt`). MIT license and both repositories are cited in `NOTICE.md`:

- https://github.com/ccxt/ccxt
- https://github.com/dailyfundeyt-crypto/ccxt

`scripts/setup-ccxt.sh` can add the fork as a submodule at `vendor/ccxt` when someone wants the connectors locally. Those connectors stay CCXT code.
