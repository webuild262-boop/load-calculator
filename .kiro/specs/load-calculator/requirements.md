# Load Calculator — Requirements

The governing definition, in the author's words: the Load Calculator is a variable calculator. It takes multiple various variables, each changeable by quantity, size, weight, and/or time. The operator places the variables needed as input, and the placed variables create the equation; the equation calculates the best output for the outcome requested. Time and timing sit at the core of every calculation. Production and shipping for manufacturing is this case, not the definition.

## 1. Data sets

1.1 Each variable group SHALL be its own data set with its own calculation. No set reaches inside another; the matcher reads all sets.
1.2 This case places seven data sets: Warehouse Inventory, Production, Gate and Trailer Schedule, Upcoming Orders, Cost Table, Recycling, and Common Orders and Runs. The count belongs to the case, not the calculator.
1.3 Warehouse Inventory entries SHALL carry: order ID, business, destination lane, pallets, delivery window (earliest and latest), date finished, days waiting, partial-allowed flag. Its calculation is age and urgency ranking.
1.4 Production SHALL track each running order's percent complete and machine rate. Its calculation is projected ready time, with variance that shrinks as completion nears.
1.5 The Gate and Trailer Schedule SHALL carry each scheduled pickup's gate, lane, box type, scheduled arrival, and scheduled departure. Vehicles are third-party tractor-trailers and box trucks arriving on a schedule the business sets.
1.6 The Cost Table SHALL carry rate per box type per lane and a per-pallet handling figure.
1.7 Recycling SHALL tally materials in versus recycling out per order and per machine. When outbound waste reaches a full pallet, it SHALL become a schedulable pickup the engine can place into a light gate window.
1.8 Common Orders and Runs SHALL be placed as standing entries on their recurring pattern and SHALL feed the queue and the matcher like any other order.

## 2. The load variable

2.1 A load SHALL be a computed variable set of identical shape: pallets; business; destination lane; delivery window; projected ready time; ready-time confidence; priority; partial-allowed flag; state.
2.2 Load states SHALL be exactly: inventory, projected, calculated, assigned, set to move, set to go, shipped.
2.3 Each placed variable SHALL declare the dimensions it is changeable by — quantity, size, weight, and/or time.

## 3. Production alerts

3.1 At 85 percent complete, the engine SHALL publish the order's projected ready time to the matcher, and the load SHALL enter the variation pool as a projection.
3.2 At 95 percent complete, the engine SHALL run the final ready-time calculation. Plans MAY be built on the calculated time as firm.
3.3 The alert percentages are placed variables, changeable at will.

## 4. Gate placement

4.1 Placement SHALL be a time equation: loading duration = pallets × load rate for the box type + setup time + loading already queued at that gate.
4.2 A load SHALL be placed on a scheduled pickup only if ready time + loading duration is at or before the scheduled departure, with no overlap against the load ahead of it at that gate.

## 5. The variation engine

5.1 The engine SHALL enumerate candidate plans across loads × box types × gates × scheduled departures, including partial splits.
5.2 The engine SHALL prune any variation that violates lane, delivery window, box capacity, or the gate time equation before scoring.
5.3 Each surviving variation SHALL be scored on truck fill percentage, cost per pallet, delivery-window slack, and inventory age. The best total score wins.
5.4 The engine SHALL re-run on each 85 or 95 alert, each wrench event, each operator override, and the daily planning run.
5.5 The interface SHALL show a live variations-evaluated counter, the top three candidate plans with scores, and one line stating why the winner won.
5.6 Shipments SHALL appear as dots on a board, shaded on a sliding green-yellow-red scale from calculated health (fill, window slack, cost against target) after each calculation. A dot enters the board when its load does, at projection, and re-shades on every re-run. Color is an output of the calculation, never an input.
5.7 When the best available plan still leaves a truck light, the app SHALL say so and show the cost.

## 6. Partials

6.1 Part of a projected or calculated load MAY ship early when it fills a trailer that would otherwise leave light, when the delivery window allows an early partial.
6.2 An order larger than one box SHALL be split across departures or loaded turned, whichever scores better.

## 7. The daily cycle

7.1 Through the day the data sets update quietly; the plan does not thrash.
7.2 The cycle SHALL close at a placed time (demo configuration: 1:30 PM, against shifts starting 7:00 AM and running to 3:00 PM). At the close, loads go out per customer instructions: a load that ships gets its bill of lading, and a job is placed in inventory only when that is the customer's call. Inventory is the customer's decision, never the system's default.
7.3 The close of the current day is for the next day: the setups it produces are for the following day. Whatever is set up ready to go SHALL have been confirmed full before it is set to go.
7.4 The production setup SHALL be the staging mechanism for shipping: Processing considers the shipping plan in its lineup, so loads reach setup in the order and timing Shipping planned. Physical staging and forklift work are out of scope.

## 8. Laden safeguards

8.1 Before any bill of lading is issued, a confirmation calculation SHALL verify the plan is current and SHALL look 15 minutes ahead: any order completing inside that window that would adjust the current plan is folded in first, through the same variation schema. Only then is the laden established.
8.2 Each pre-laden adjustment SHALL count toward a volatility limit (placed parameters; demo defaults 3 adjustments inside one hour, or 5 inside two hours). On hitting the limit, the engine SHALL approximate the remaining runs through the close, close that day's ship scheduling, and move established loads to setup — set to move.
8.3 Latest-window check: for each outgoing load the engine SHALL check the delivery date and the latest delivery window the customer allows, and SHALL target the latest window when delivering at that point saves on shipping; otherwise it plans to the customer's date.

## 9. The two modes after the laden

9.1 Dispatch mode: once a bill of lading is established, loads SHALL dispatch from the bill. The bill is the source of truth for what leaves. A dispatched load is set to go.
9.2 Correction mode: a correction after the laden SHALL change nothing about the truck. Its arrival is not a variable, for the system or for the operator. The correction SHALL be absorbed entirely on the load side — what is loaded, what is held, what moves to a later departure — while the truck's movement and the rest of the bill stand exactly as scheduled.

## 10. The watcher

10.1 After the close, the watcher SHALL monitor live parameters against set thresholds (default: an alternative plan saving at least 5 percent on the affected load, or rescuing a delivery window the plan set at the close would miss).
10.2 An alert SHALL present the proposed better plan with its numbers. The watcher SHALL never re-plan silently. A human accepts or ignores each alert, and the decision is logged.

## 11. Wrenches and overrides

11.1 Hot order: a rush order SHALL skip the line, take production priority, shift projected ready times behind it, and trigger re-scoring of affected gate plans. The cost of the disruption SHALL be shown.
11.2 Pulled order: a pulled order's pallets SHALL leave the plan; the engine SHALL backfill from inventory first, then from a partial ahead, or the trailer leaves light with the cost shown.
11.3 Any load SHALL carry a drop-down control to change its destination or its size. An override recalculates the affected set at once. After the laden, overrides run in correction mode.
11.4 Small-job matching: when a smaller job comes out with an upcoming delivery date, the system SHALL queue an operator call to confirm the exact delivery window, SHALL scan inventory before the last day for anything that can ride with it (same lane, compatible window), and SHALL queue a second call to confirm delivery — even a partial of a full order — when a match is found.

## 12. Telemetry

12.1 Every input the system runs on — alert percentages, load rates, box capacities, cost tables, lanes, gate count, planning-run and close time, volatility limits, watcher threshold, schedules as entered — SHALL be changeable by the operator at any time, and the engine SHALL recalculate from the change.
12.2 The single exception is a physical fact already in motion: a truck that is coming in.

## 13. Demo configuration

13.1 Machines: 5. Gates: 2. Orders: 10–25 pallets each, from several businesses and lanes. Inventory: 100 seeded entries.
13.2 Box types: 45-foot trailer, 22 pallets loaded straight (26 turned); 26-foot box truck, 12 pallets. Pallet basis: standard 40 × 48 inch.
13.3 A shift clock SHALL run accelerated time: a full operating day in about three minutes.
13.4 Engine-on versus engine-off comparison counters (cost, average fill) SHALL be visible throughout.
13.5 Two industry presets SHALL ship with the demo; one switch re-places every variable while the calculator core runs unchanged.
13.6 Judge Mode: a pre-seeded scenario identical to the demo-video scenario, runnable in seconds — change one variable and watch the consequence propagate: projection published, variations scored, final ready time calculated, plan updated, watcher explaining the cost avoided.
