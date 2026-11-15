# Load Calculator — Build Tasks

## 1. Foundation
- [ ] Repository live with license, README, and `/.kiro` committed at the root
- [ ] Engine package skeleton in `packages/variable-engine` (no application logic inside)
- [ ] Load variable type with the seven states: inventory, projected, calculated, assigned, set to move, set to go, shipped
- [ ] Placed-variable model: each variable declares its changeable dimensions (quantity, size, weight, and/or time)

## 2. Data sets (this case)
- [ ] Warehouse Inventory set + age/urgency ranking; seed ~100 entries
- [ ] Production set + projected ready time calculation
- [ ] Gate and Trailer Schedule set + availability and loading-time capacity
- [ ] Upcoming Orders set
- [ ] Cost Table set + candidate-load cost and cost per pallet
- [ ] Recycling set: materials in / recycling out per order and per machine; full-pallet pickup trigger
- [ ] Common Orders and Runs as standing entries

## 3. Engine calculations
- [ ] 85% alert: publish projected ready time, load enters variation pool
- [ ] 95% alert: final ready-time calculation
- [ ] Gate placement time equation with no-overlap rule
- [ ] Variation enumeration, pruning, scoring (fill, cost per pallet, window slack, inventory age)
- [ ] Transparency: variations counter, top-3 plans, why-the-winner-won line
- [ ] Partials: partial-ahead and oversize split-or-turn
- [ ] Latest-window check
- [ ] Color board: shipment dots shaded green-yellow-red from calculated health

## 4. Daily cycle
- [ ] Close at the placed time (demo 1:30 PM): bills of lading per customer instructions; inventory only on the customer's call; next day's setups, confirmed full
- [ ] Pre-laden confirmation: plan currency + 15-minute lookahead fold-in
- [ ] Early close on volatility limits (defaults 3 in 1 hour / 5 in 2 hours)
- [ ] Dispatch mode: dispatch from the bill; dispatched loads set to go
- [ ] Correction mode: truck unchanged; correction absorbed on the load side
- [ ] Watcher: threshold alerts with proposed plan and numbers; accept/ignore logged; never re-plans silently

## 5. Disruption and control
- [ ] Throw a Wrench: hot order skips the line; pulled order backfills or leaves light with cost shown
- [ ] Load drop-down overrides (destination, size); post-laden overrides run in correction mode
- [ ] Small-job matching: queued confirmation calls with candidate matches attached
- [ ] Telemetry panel: every placed variable editable at will; engine recalculates from the change

## 6. Applications
- [ ] Processing app: machine board, queue and priority, completion projections, materials/recycling view
- [ ] Shipping app: inventory, gates, plan, bills of lading, watcher alerts
- [ ] Setup handover: Processing lineup considers the shipping plan

## 7. Demo and submission
- [ ] Accelerated shift clock (a day in ~3 minutes); engine-on vs engine-off counters
- [ ] Two industry presets; one switch re-places every variable live
- [ ] Judge Mode: pre-seeded scenario, one variable change propagates end to end
- [ ] Deploy the working app to Azure; public URL for judging
- [ ] Demo video under 3 minutes, public on YouTube, following the spec's script
- [ ] Kiro-usage writeup: specs, steering, hooks, agents
