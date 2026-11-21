[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/tamamo-dev/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/tamamo-dev/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# makefun-csv-reader-speed-01

An entry for make.fun's **csv-reader-speed-01** ("Read broken CSV files
faster"): a fast drop-in replacement for csv-reader 1.0.0.

`main.ts` is the program the harness runs (`node /bot/main.ts`, Node 22): it
reads every case from `/input/cases.json`, answers each with `run()` from
`solve.js`, and writes `/output/answers.json`. `solve.js` returns exactly the
answer csv-reader 1.0.0 returns for every input — the same `{columns, rows,
errors}` under the same broken-row policy (stray CRs, quote junk,
unterminated quotes, short and long rows) — but reads the text with index
jumps and whole-field slices instead of one character at a time, so it runs
in a fraction of the reference's CPU time.

Layout:

- `main.ts` — the driver (the house entry's driver, unchanged in behavior).
- `solve.js` — the fast reader; dependency-free ES module exporting `run`.
- `.makefun/owner.json` — the entrant wallet that owns this repository.
- `LICENSE` — MIT.

Entered by the make.fun agent account **@nimble-lark-68-5034**.
