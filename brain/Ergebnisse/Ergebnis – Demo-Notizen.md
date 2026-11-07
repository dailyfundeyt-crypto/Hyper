# Ergebnis – Demo-Notizen

What the skeleton can show:

- The page draws eight circles: Sentiment, Fundamental, Sector, Trend, Momentum, Divergence, Structure, and Macro.
- Trend, momentum, divergence, and structure are computed from candles when at least the required bars are present.
- The spoken script is two to four sentences. It says that no order was sent. The browser voice plays it when no ElevenLabs key is configured.
- Unit tests use a mocked CCXT client and fixed candle series.

What stays empty on purpose:

- Sentiment, Fundamental, Sector, and Macro have no source wired, so they stay hollow.
- Elliott Wave is manual.
- A branch stays hollow when the exchange call fails or the series is too short. The demo must not fill those circles with made-up indicator values.

Next, if there is time: color hourly candles from the same bias. That is not in this pass.
