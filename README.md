# Load Calculator

**One Engine. Two Decisions. Endless Applications.**

Load Calculator is a variable calculator. It takes multiple various variables that are changeable by quantity, size, weight, and/or time. The operator places the variables needed as input, and the placed variables create the equation. The equation calculates the best output for the outcome requested. Time and timing sit at the core of every calculation the engine runs.

This case places production and delivery variables for manufacturing: streamlining the process for greater productivity, greater output, and less friction. Loads go out per customer instructions, and nothing in the system is fixed — every variable can be changed at will.

## The foundation

One reusable variable engine reads the data sets the operator places — in this case: warehouse inventory, production, the dock and trailer schedule, upcoming orders, the cost table, recycling, and common orders and runs. The sets belong to the case; the engine reads however many are placed. Across the sets, the engine, and its checks, this case runs nearly two dozen moving calculations at once to bring the best result.

## The two applications

- **Processing** (`apps/processing`) — the production application. What runs, in what order, finishing when — with materials in and recycling out tracked per order and per machine. The production setup is the staging mechanism for delivery: Processing lines up its runs considering the delivery plan, so Delivery receives loads already in line.
- **Delivery** (`apps/delivery`) — the freight application. What goes out, in which box, from which dock, at what time, at what cost — matched while orders are still in production, not after they reach a warehouse.

The shared engine lives in `packages/variable-engine`. Neither application contains the other's logic.

## Built with Kiro

This project is a Kiroween 2026 entry (Skeleton Crew) by Webuild262. The build is spec-driven: the governing spec lives in `.kiro/specs/load-calculator/`, and the steering rules in `.kiro/steering/` protect the boundary between the reusable engine and the applications on top of it.

## Status

Build in progress. The demo's operator can now place variables — a new order, a new departure, threshold and rate settings — and watch the equation resolve again around them. Demo configuration: 5 machines, 2 docks, orders of 10–25 pallets, two box types (45-foot trailer at 22 pallets straight-loaded, 26-foot box truck at 12), a full operating day in about three minutes of accelerated time.

## License

MIT — see `LICENSE`. Copyright (c) 2026 Allen Ramirez (Webuild262).

This repository is the Kiroween 2026 contest entry, MIT-licensed because the contest rules require a public, open-source repository. The commercial product built on this work is separate and is not part of this repository.
