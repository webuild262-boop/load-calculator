# Load Calculator — Design

## Architecture

One reusable variable engine; two applications on top of it; nothing else holds logic.

```
packages/variable-engine   the engine: data sets, load variable, calculations, watcher
apps/processing            the production application (consumes the engine)
apps/shipping              the freight application (consumes the engine)
```

The engine separates variables, thresholds, rules, and decision states from any application's workflow or presentation, so the core never changes between deployments. Each business places its own variables into the engine: its unit (pallets, rolls, crates, cases), box types and capacities, load rates, alert percentages, planning-run and close times, lanes, and cost table. Print and packaging is the first configuration, not the boundary.

## The calculation inventory

Counted out, this case runs nearly two dozen moving calculations at once:

- **From the sets:** inventory age and urgency ranking; projected ready time per running order; gate availability; loading-time capacity per pickup; candidate-load cost; cost per pallet; the recycling tally of materials in against recycling out; recurring-pattern placement for common orders and runs.
- **From the engine:** load state computation; the final ready-time calculation at 95 percent; the gate placement time equation; variation enumeration; feasibility pruning; variation scoring; the partial-ahead determination; the split-or-turn determination on oversize orders.
- **From the checks:** the latest-window check; the pre-laden confirmation of plan currency; the pre-laden 15-minute lookahead fold-in; the early-close volatility count; the small-job match scan; the watcher comparison; board health shading; override and disruption re-calculation.

Several are checks inside checks — the pre-laden step alone runs two, and the volatility count runs against two windows at once.

## The handover

The two applications read the same data sets and share the calculator core. Neither contains the other's logic. The handover between them is the setup: the production setup is the staging mechanism for shipping, so Processing considers the shipping plan in its lineup — departures, gates, fill needs — and Shipping takes loads from setup with no staging layer of its own.

## Demo

Simulated feeds stand in for plant systems; the calculation core accepts real feeds unchanged. An accelerated shift clock plays a full operating day in about three minutes. Judge Mode reuses the demo scenario as a pre-seeded, judge-runnable run.

## Deployment

Hosted on Azure (Startups subscription): the working application is served from Azure — Container Apps or App Service — with Cosmos DB for the data sets and Blob storage for artifacts. Distribution path, in order:

1. **Service catalog** — the build packaged as an Azure Managed Application (mainTemplate.json + createUiDefinition.json) and published to Webuild262's internal service catalog: available only within the organization, no Partner Center account, no certification queue.
2. **Private plans** — a Partner Center marketplace offer (Azure Application) whose plans are private, targeted by subscription ID, invisible in the public Marketplace, for pilot customers.
3. **Public Marketplace** — a public plan when the product is ready; customer organizations can then approve it into their own Private Microsoft Marketplace collections. Certification runs on a timeline of weeks, so the listing is a post-Kiroween milestone, never a submission dependency.

## The shelf (checked November 14, 2026)

A search of Azure Marketplace's own catalog found the load category occupied by 3D packing geometry (ORTEC), enterprise load suites (TCS), ERP add-ons (OmniFY for Business Central), and AI load building that starts from planned orders inside a customer's ERP/WMS (ProvisionAI AutoO2). Nothing found starts from live production, serves the plant with no ERP and no logistics department, or is built as a general placed-variable calculator. This design is written against that gap.
