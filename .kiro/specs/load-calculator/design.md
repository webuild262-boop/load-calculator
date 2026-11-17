# Load Calculator — Design

## Architecture

One reusable variable engine; two applications on top of it; nothing else holds logic.

```
packages/variable-engine   the engine: data sets, load variable, calculations, watcher
apps/processing            the production application (consumes the engine)
apps/delivery              the freight application (consumes the engine)
```

The engine separates variables, thresholds, rules, and decision states from any application's workflow or presentation, so the core never changes between deployments. Each business places its own variables into the engine: its unit (pallets, rolls, crates, cases), box types and capacities, load rates, alert percentages, planning-run and close times, lanes, and cost table. Print and packaging is the first configuration, not the boundary.

## Variable creation (built November 17, 2026)

The demo's "Place a variable" panel is the operator-facing creation surface the requirements' telemetry section calls for. It writes through three engine entry points — `placeOrder`, `placeDeparture`, `placeSettings` — so a created entry lands in the same data sets the seeded day uses (Warehouse Inventory, the Dock and Trailer Schedule, and this run's settings) and travels the same matcher and watcher paths as a wrench event. Settings are held per run of the day: a fresh day starts from the placed defaults, so the seeded Judge Mode day reproduces its measured line exactly until the operator places something. An order entry carries its full breakdown — quantity, weight, time, and the wider measures (volume for liquid; form and amount for chemical) — while the demo engine plans it by pallets, lane, ready time, and delivery window; the wider measures ride on the entry as placed measures, the parameter set being open by design.

Still queued as design language, not built: the spare-room scan and two-load booking (spec section 8), and reverse calculation (spec section 1). The demo calculates forward, and computes per-departure spare capacity and partial-ahead splits, today.

## The calculation inventory

Counted out, this case runs nearly two dozen moving calculations at once:

- **From the sets:** inventory age and urgency ranking; projected ready time per running order; dock availability; loading-time capacity per pickup; candidate-load cost; cost per pallet; the recycling tally of materials in against recycling out; recurring-pattern placement for common orders and runs.
- **From the engine:** load state computation; the final ready-time calculation at 95 percent; the dock placement time equation; variation enumeration; feasibility pruning; variation scoring; the partial-ahead determination; the split-or-turn determination on oversize orders.
- **From the checks:** the latest-window check; the pre-laden confirmation of plan currency; the pre-laden 15-minute lookahead fold-in; the early-close volatility count; the small-job match scan; the watcher comparison; board health shading; override and disruption re-calculation.

Several are checks inside checks — the pre-laden step alone runs two, and the volatility count runs against two windows at once.

## The handover

The two applications read the same data sets and share the calculator core. Neither contains the other's logic. The handover between them is the setup: the production setup is the staging mechanism for shipping, so Processing considers the shipping plan in its lineup — departures, docks, fill needs — and Delivery takes loads from setup with no staging layer of its own.

## Demo

Simulated feeds stand in for plant systems; the calculation core accepts real feeds unchanged. An accelerated shift clock plays a full operating day in about three minutes. Judge Mode reuses the demo scenario as a pre-seeded, judge-runnable run.

## Deployment

Hosted on Azure (Startups subscription): the working application is served from Azure — Container Apps or App Service — with Cosmos DB for the data sets and Blob storage for artifacts. Distribution path, in order:

1. **Service catalog** — the build packaged as an Azure Managed Application (mainTemplate.json + createUiDefinition.json) and published to Webuild262's internal service catalog: available only within the organization, no Partner Center account, no certification queue.
2. **Private plans** — a Partner Center marketplace offer (Azure Application) whose plans are private, targeted by subscription ID, invisible in the public Marketplace, for pilot customers.
3. **Public Marketplace** — a public plan when the product is ready; customer organizations can then approve it into their own Private Microsoft Marketplace collections. Certification runs on a timeline of weeks, so the listing is a post-Kiroween milestone, never a submission dependency.

## The shelf (checked November 14, 2026)

A search of Azure Marketplace's own catalog found the load category occupied by 3D packing geometry (ORTEC), enterprise load suites (TCS), ERP add-ons (OmniFY for Business Central), and AI load building that starts from planned orders inside a customer's ERP/WMS (ProvisionAI AutoO2). Nothing found starts from live production, serves the plant with no ERP and no logistics department, or is built as a general placed-variable calculator. This design is written against that gap.
