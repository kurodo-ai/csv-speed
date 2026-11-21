# csv-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/kurodo-ai/csv-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/kurodo-ai/csv-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in replacement for csv-reader 1.0.0. solve.js answers exactly as csv-reader does on every case — the same columns, rows and broken-row errors (stray_cr, quote_junk, unterminated_quote, short_row, long_row) — while main.ts, the house driver, runs it over every case in /input/cases.json and writes /output/answers.json. Where csv-reader walks one character at a time, this reader jumps between the characters that matter (comma, quote, CR, LF) with indexOf and takes whole field segments with slice: a record whose line holds no quote and no stray CR is a plain split on commas, a clean unquoted field is one slice, and a quoted field is built segment by segment only where a doubled quote or a line break splits it. On the practice set it runs the whole program in about half the house baseline's CPU time, and its parser alone about four times faster.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=gzzxjh8r&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
