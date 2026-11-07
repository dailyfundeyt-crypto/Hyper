# Ablauf – Heartbeat

Every 30 minutes:

1. Refresh public candles for the symbol (default `BTC/USDT`, timeframe `1h`).
2. Run the truth test on the 200 EMA. If the two methods disagree, mark the trend branch as a contradiction.
3. Rebuild confluence. Hollow branches stay hollow.
4. Speak only when the bias flips against the open idea, or when at least two branches flip together.
5. The spoken line is a warning. It must say that no order was sent.

The server tool is `run_heartbeat`. It does not place an order.
