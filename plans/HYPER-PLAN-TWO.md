# Hyper Plan Two — Signal and voice

You are person 2. Work on branch `b/signal`. You own `adapters/indicators/`, `brain/`, `identities/`, and `web/`. Do not edit `server/` MCP auth, Zapier token handling, Vercel env, or `adapters/market/` internals.

Paste each prompt below into your coding agent, in order. A step is done when the named files exist and person 1 can pull without broken imports.

## Goal

Ship Python indicators from the Drive lesson, Dusty-style markdown brain files, five Hermes `AGENT.md` identities, a confluence table of circles, and a speaking voice.

## Step-by-step

1. Create branch `b/signal` from `main`.
2. Implement EMA 200 / 50, SMA 50, RSI, MACD, Stochastic RSI, divergences, and lite FVG / BOS / ChoCh.
3. Create `brain/` folders like Dusty: `Abläufe`, `Arbeiten`, `Ergebnisse`, `Memory`, `Skills`. Mirror them in the Drive folder Agenten / Hyper, and do not write into Dusty Agent.
4. Write the five identity `AGENT.md` files. Security is a gate, not a long/short vote. Do not include the discarded regulation prompt.
5. Build a minimal page: confluence circles plus voice. No heatmap and no Wyckoff chart today.
6. Merge to `main` every 60 to 90 minutes.

## Indicator template

Use the Drive lesson [1. Gleitende Durchschnitte (EMA & SMA) als Trendfilter](https://drive.google.com/file/d/1dLSuCyn2umtyNy2c0zOjdoyCJ5MUCLJS/view):

- 200 EMA is the primary trend filter: close above = bullish, below = bearish.
- Also track 50 EMA and 50 SMA.
- Momentum: RSI, MACD histogram, Stochastic RSI.
- Bullish divergence: price lower lows, oscillator higher lows.
- Skip automating Elliott Wave today.
- Never invent a reading. An empty branch stays hollow.

## Prompts

P21: Implement EMA 200, EMA 50, and SMA 50 in Python from the Drive trend-filter lesson.
P22: Code the rule: close above the 200 EMA marks the technical branch bullish; below marks it bearish.
P23: Implement RSI 14.
P24: Implement MACD 12, 26, 9 and its histogram.
P25: Implement Stochastic RSI and flag overbought or oversold without auto-trading.
P26: Detect bullish divergence: price lower lows, RSI or MACD histogram higher lows.
P27: Detect bearish divergence: price higher highs, oscillator lower highs.
P28: Detect a simple 3-candle fair value gap on recent 1h bars.
P29: Detect simple swing highs and lows, then flag a break of structure and a change of character.
P30: Do not automate Elliott Wave today. Write a short brain note that it stays manual.
P51: Create `brain/Abläufe`, `brain/Arbeiten`, `brain/Ergebnisse`, `brain/Memory`, and `brain/Skills`, matching Dusty. In Drive, use Agenten / Hyper, not Dusty Agent.
P52: Do not write into the Dusty Agent folder.
P53: Write `Abläufe/heartbeat.md`: every 30 minutes refresh, truth-test, and speak if bias flips.
P54: Write `Abläufe/confluence.md`: how each branch is scored positive, neutral, or negative.
P55: Write `Arbeiten/open-idea.md` as a template for symbol, side, and invalidation.
P56: Write `Skills/trend-filter.md` from the EMA Drive lesson.
P57: Write `Skills/momentum-divergence.md` from the oscillator section of that lesson.
P58: Write `Skills/smc-lite.md` defining FVG, ChoCh, and BOS for the lite detector.
P59: Write `Skills/truth-test.md`: never invent a number; mark contradictions instead of averaging them.
P60: Keep the same markdown files in git under `brain/` so Drive and GitHub stay aligned.
P61: Write `identities/research/AGENT.md` with the investigative OSINT primary-data prompt.
P62: Write `identities/security/AGENT.md` with scam checks for seed or key asks, QFS, and the Zahn-Test and Finger-Test.
P63: Write `identities/token/AGENT.md` with the five-point tokenomics and forensics framework.
P64: Write `identities/tradfi/AGENT.md` with the RWA and institutional liquidity five-point framework and a 1 to 10 score.
P65: Write `identities/career/AGENT.md` with the career and labor-market analyst prompt.
P66: Give each identity empty `memory` and `skills` folders so Hermes can load them later.
P67: Document how `ask()` routes by keywords; default to confluence when no identity is named.
P68: Do not include the discarded regulation prompt.
P69: Run the security gate first on every ask.
P70: Confirm an ask with identity security refuses to vote long or short.
P71: Build a minimal web page whose only visual is the confluence table.
P72: Show circles for Sentiment, Fundamental, Sector, Trend, Momentum, Divergence, Structure, and Macro.
P73: Color a circle green for long, red for short, gray for neutral, and hollow when empty.
P74: Show the numeric tilt as longs versus shorts.
P75: Under each circle show a short reason and the source; if empty, show no data.
P76: Add a symbol input that defaults to `BTC/USDT`.
P77: Load data from `get_confluence` through MCP or a thin authenticated HTTP wrapper.
P78: Show the last heartbeat time labeled Europe/Berlin.
P79: Keep the layout a single readable column.
P80: Use live public OHLCV or clearly labeled example data. Never fill a demo with invented indicator values.
P81: After each confluence, write a spoken script of two to four sentences.
P82: Play it with ElevenLabs when a key is present; otherwise use the browser `speechSynthesis` API.
P83: The voice states the bias, which branches flipped, and whether that fights the open idea.
P84: Alarm only when bias flips against the open idea or at least two branches flip together.
P85: The spoken line must warn only and must not claim that an order was sent.
P87: Keep audio under 30 seconds.
P88: Save the last spoken text under `Ergebnisse` in git (and later the Hyper Drive folder).
P89: Skip quiet-hours logic for the demo.
P90: Write a demo script: ask for BTC bias, show the table, play the voice.
P92: Truth-test the 200 EMA by computing it two ways and marking a mismatch instead of hiding it.
P98: Write `Ergebnisse/demo-notes.md` with what worked and what stayed empty.
P100: If time remains, color hourly candles from the same bias. Otherwise log that as next.
