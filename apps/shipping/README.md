# Shipping

The freight application. Its question: **what goes out, in which box, from which gate, at what time, at what cost?**

- Inventory, gate and trailer schedule, and upcoming orders read from the shared data sets
- Variation scoring across loads, box types, gates, and departures — partials in both directions, oversize orders split or turned
- The daily close: bills of lading created per customer instructions; jobs placed in inventory only when that is the customer's call; the next day's setups produced, confirmed full
- Pre-laden confirmation and the early close; dispatch mode from the bill; correction mode that absorbs changes on the load side only
- The watcher: after the close, alerts with a proposed better plan and its numbers; a human accepts or ignores

Shipping consumes the shared variable engine in `packages/variable-engine`. It contains no production logic.
