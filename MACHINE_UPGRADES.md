# PulseGrid — Machine Configuration & Upgrade Workflow

## What changed
PulseGrid now models seven assets at the Apex Motors Bengaluru passenger-vehicle plant using configurable equipment baselines. The administrator can edit each machine's name, model, production stage, rated capacity, normal sensor temperature, warning/critical temperature thresholds, reliability assumption and operating hours.

## How to use
1. Start the backend from the project root: `python backend/server.py`.
2. Sign in with the existing plant administrator account.
3. Open **Machine configuration & upgrades** on the dashboard.
4. Select the asset to modify.
5. Enter the replacement/upgrade model and its approved engineering values.
6. Keep the temperature thresholds ordered: normal setpoint < warning < critical.
7. Save. The backend validates the values and stores them in SQLite.
8. The browser reloads the saved specification and recalculates simulated capacity, thermal alerts, bottleneck pressure and downstream exposure on subsequent ticks.

## Configurable fields
- Machine name, model / equipment ID and production stage
- Rated capacity (vehicles/hour)
- Normal sensor temperature, warning threshold and critical threshold (°C)
- Reliability assumption (%) and operating hours

## Current illustrative baseline
The seven modeled stages are Body Stamping Press, Body Welding Robot Cell, Body Transfer Conveyor, Paint Curing Oven, Paint Cooling Tunnel, Final Assembly Conveyor, and End-of-Line Inspection & Dispatch.

The default capacity assumptions are approximately 50–60 vehicles/hour. Equipment temperature readings and alarm limits are plausible demonstration values only. They are not OEM specifications, process recipes, or safety limits. Replace them with approved plant engineering data before any real operational use.

## How the simulation uses the settings
- Rated capacity sets the machine's modeled upper throughput.
- Reliability applies a small availability/effective-capacity assumption.
- Temperatures above the configured warning threshold progressively derate effective capacity.
- Reaching the critical threshold changes machine status to critical and creates an alert.
- A rising temperature trend near the warning threshold creates a predictive warning.
- Downstream impact is derived from the machine's position in the production sequence.
- Queue growth uses hourly rates converted to a one-minute simulation interval.

## Scope and limitations
This remains a single-factory, browser-simulated hackathon prototype. Telemetry is synthetic. The fault rules and projections are explainable heuristics, not trained predictive-maintenance models. The current production path is a sequential seven-stage line; alternate routing, parallel cells, buffer capacities, shift calendars, vehicle mix and validated maintenance models are not yet implemented.

Do not use the prototype to control real machinery. Real deployments require validated OT integration, access controls, network segmentation, safety interlocks, OEM-approved limits, sensor validation and operational engineering review.
