# PulseGrid menu navigation and fault simulator

## Navigation
The existing dashboard components are preserved and reorganized into menu pages:
- Overview: plant KPIs and operating context
- Machines: seven machine cards and machine controls
- Machine upgrades: existing engineering configuration console
- Factory view: Canvas factory view and SVG dependency map
- Fault diagnostics: root-cause/ripple panel and alert list
- Fault simulator: what-if planner, configurable fault injection and legacy demo controls

The navigation script moves existing DOM components at runtime and preserves their IDs so the existing simulation code continues to work.

## Fault injection
Select one of the seven assets, choose a scenario, choose its severity and choose the impact scope:
- Machine stoppage
- Reduced speed (50%)
- Thermal excursion
- Mechanical jam / blocked transfer
- Warning: reduced capacity
- Critical: selected machine unavailable
- Emergency: whole production line stopped
- Local machine: only the selected machine is affected
- Production line: every machine stops and line output becomes zero

The selected fault creates an incident report in Fault response & reports, with machine-specific diagnosis and rectification guidance. The machine status, alerts/diagnostics, downstream impact, units/hour and financial exposure are recalculated from severity. Faults remain active until the operator clears or resolves them. The plant power dip and legacy demo faults follow the same latched behavior and are cleared with the resolve controls.

This is a synthetic demonstration only. It does not connect to PLCs, safety interlocks or physical equipment.

## Data units and accuracy
Throughput is expressed as vehicles/hour; temperatures are °C; work-in-progress is expressed as vehicles/vehicle bodies waiting between stations. The demo's 50–60 vehicles/hour line rate and machine-specific temperature thresholds are illustrative engineering assumptions for a high-volume passenger-vehicle assembly line. They are not verified OEM specifications or real Apex Motors measurements. Replace them with approved plant historian/PLC data and equipment-manufacturer limits before operational use.

## Run
From the project root:
```bash
python backend/server.py
```
Then open http://localhost:3000.
