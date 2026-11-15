# Steering — Architecture Rules

These rules bind every agent and every session working in this repository.

## The boundary

- The variable engine (`packages/variable-engine`) holds all calculation logic. Applications consume it; they never re-implement it.
- Processing logic never enters Shipping, and Shipping logic never enters Processing. Neither application's logic enters the engine.
- The engine is industry-blind and function-blind. Industry specifics live in placed variables and presets, never in engine code.

## The design's own words

- The definition is fixed: a variable calculator whose placed variables create the equation that calculates the best requested output. Production and shipping for manufacturing is this case, not the definition. Do not restate the definition as a production or freight tool.
- Time and timing are core calculations. Keep them named as such.
- The daily plan is **set at the close**. The design has no other plan state: do not introduce states, terms, or mechanisms the spec does not name — in particular, nothing in this design is ever described as frozen or locked, at 95 percent or at the close.
- The 95 percent alert means one thing: the run is ending shortly, so the engine runs the final ready-time calculation.
- Inventory is the customer's decision. Loads go out per customer instructions. Never present inventory placement as a system default.
- Materials in and recycling out are tracked per order and per machine. Do not drop this from any view or summary.
- The data sets placed for this case number seven. The count belongs to the case; never present it as a fixed property of the calculator.

## Change discipline

- When the spec changes, change the spec files first, then the code. Code follows `.kiro/specs/load-calculator/`.
- Telemetry is changeable at will by design: any placed variable may change at any time and the engine recalculates. The single exception is a physical fact already in motion — a truck that is coming in.
