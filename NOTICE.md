# Notices

Hyper reads public market data through [CCXT](https://github.com/ccxt/ccxt). CCXT is licensed under the MIT License.

- Upstream: https://github.com/ccxt/ccxt
- License: MIT — https://github.com/ccxt/ccxt/blob/master/LICENSE.txt
- This team's fork: https://github.com/dailyfundeyt-crypto/ccxt

The CCXT source tree is not vendored here. The Python package `ccxt` is declared in `requirements.txt` and `pyproject.toml`. `scripts/setup-ccxt.sh` can optionally add the fork as a git submodule at `vendor/ccxt` for reference. Exchange connectors in that tree are CCXT code, not Hyper product code.

`vendor/muse-inbox/` is a sanitized copy of our Inbox app used as the pattern for MCP auth, the Zapier proxy, and `POST /api/messages`. It is not an upstream CCXT distribution. Do not add API keys, tokens, owner keys, or flag URLs to it.
