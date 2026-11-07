# Identities

`ask(text, identity)` loads one `AGENT.md`.

Security runs first. If the text asks for a seed phrase, a private key, a recovery phrase, or a QFS step, the reply is the security gate. That reply has no long/short side and no tilt.

If `identity` is set, it must be one of `research`, `security`, `token`, `tradfi`, or `career`. An ask with identity `security` does not vote, even when the text is about price.

If `identity` is omitted, keywords choose the file:

| Words in the text | Identity |
| --- | --- |
| security, scam, seed phrase, private key, qfs | security |
| research, osint, primary source, filing | research |
| tokenomics, token, vesting, unlock | token |
| tradfi, rwa, institutional liquidity | tradfi |
| career, labor market, hiring, job market | career |

Anything else is routed to confluence (`get_confluence`), not to a guessed identity.

Each identity has empty `memory/` and `skills/` folders so a later loader can drop files there. They ship with a `.gitkeep` only.
