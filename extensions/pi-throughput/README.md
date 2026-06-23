# pi-throughput

Shows the speed of each assistant response as output **tokens/sec** in pi's
footer status line.

Example footer entry:

```
⚡ 48.2 tok/s (2.3k in 47s)
```

## How it works

- At the start of each assistant message it records a timestamp
  (`message_start`).
- When the message finalizes (`message_end`) it reads `usage.output` (the
  output token count reported by the provider) and divides by the elapsed
  wall-clock time.
- The result is shown as a persistent footer status that stays visible until
  the next response completes.

Color reflects throughput:

| Rate          | Color   |
| ------------- | ------- |
| ≥ 60 tok/s    | success |
| ≥ 25 tok/s    | accent  |
| < 25 tok/s    | warning |

Only assistant messages are timed. User and tool-result messages are ignored,
and a no-op in non-UI modes (`-p`, JSON mode) where there is no footer.

> **Note:** The metric is wall-clock throughput (`output tokens ÷ elapsed time`),
> which includes time-to-first-token. It is a response-speed indicator, not a
> pure streaming-decode rate.

## Installation

### Manual (development)

Copy the directory into your pi agent extensions folder:

```bash
cp -r extensions/pi-throughput ~/.pi/agent/extensions/
```

Then restart pi or run `/reload`.

### Via `pi install`

```bash
pi install git:github.com/h311x/pi-extensions
```

Then restart pi or run `/reload`.

## Status key

`throughput` — if another extension already uses this footer slot, change
`STATUS_KEY` in `index.ts`.
