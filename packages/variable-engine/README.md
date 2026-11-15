# Variable Engine

The reusable foundation. One engine, consumed by every application in this repository.

- **Data sets** — each variable group is its own data set with its own calculation; the matcher reads all sets. This case places seven; the engine reads however many are placed.
- **The load variable** — one computed shape for every load: pallets, business, destination lane, delivery window, projected ready time, ready-time confidence, priority, partial-allowed flag, and state (inventory, projected, calculated, assigned, set to move, set to go, shipped).
- **Calculations** — time and timing at the core: ready-time projection and final calculation, the gate placement time equation, variation enumeration, pruning, and scoring, the laden safeguards, and the watcher.
- **Telemetry** — every input is a placed variable, changeable at will; the engine recalculates from any change. The single exception is a physical fact already in motion.

The engine holds no application workflow and no presentation. Processing and Shipping are its first two consumers; they will not be the last two.
