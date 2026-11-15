# Processing

The production application. Its question: **what runs, in what order, finishing when?**

- Machine board and order queue with run priority, including hot orders that skip the line
- Completion projections from the engine's two alerts: at 85 percent the projected ready time is published; at 95 percent the engine calculates the final ready time
- Materials in and recycling out, tracked per order and per machine
- The lineup considers the shipping plan — departures, gates, and fill needs — so loads reach setup in the order and timing Shipping planned. The production setup is the staging mechanism for shipping.

Processing consumes the shared variable engine in `packages/variable-engine`. It contains no shipping logic.
