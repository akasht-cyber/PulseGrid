# PulseGrid operations refinement

## Design changes
- Replaced the horizontal tab row with a compact left-side operations menu (collapses to a horizontal scroll menu on small screens).
- Replaced the saturated cyan/navy aesthetic with a restrained graphite/steel palette and muted status colors.
- Retained the existing application pages and DOM IDs so current simulation and controls remain integrated.

## Financial impact monitor
The overview contains a live simulation-based opportunity-cost estimate:
- Healthy line baseline is the minimum rated machine capacity after the model's configured reliability derate.
- Current line throughput is estimated as the minimum current machine rate.
- Hourly exposure = max(0, healthy baseline - current throughput) × assumed contribution margin per vehicle.
- Cumulative opportunity cost accrues per simulated minute: lost vehicle-equivalent per minute × contribution margin.
- The contribution margin is editable in the overview.

Important: this is a planning estimate, not booked financial loss, lost revenue, insurance loss or audited accounting. It excludes labor, overhead, inventory buffers, overtime, contractual penalties, repair costs and recovery ramp effects. Replace the default ₹35,000 assumption with Finance-approved plant-specific contribution margin data. The simulation clock is accelerated (one model tick represents one simulated production minute; browser timer runs approximately every 1.5 seconds).

## Fault simulation
The Fault Simulator can inject stoppage, 50% speed reduction, overheat and jam faults against any of the seven machine IDs. The selected scenario persists for its configured number of simulated minutes, appears in fault diagnosis and changes the model's machine rate, status, alerts and downstream impact. The scenario can be cleared manually. It is synthetic and does not connect to PLCs or real safety systems.

## Factory visualization
The Canvas view now draws distinct automotive process equipment: a stamping press frame, robotic welding cell and vehicle body, roller conveyors with BIW shell, paint curing tunnel, cooling tunnel/extractor fans and end-of-line inspection gantry. It remains an illustrative isometric visualization, not a CAD model or engineering layout.

## Data caveat
All operating data remains simulated. Vehicle throughput values are expressed in vehicles/hour, WIP in vehicle bodies/vehicles, temperatures in °C, and financial values in INR. Temperature thresholds and machine capacities are illustrative assumptions and must be validated against OEM documentation and site process engineering before real-world use.

## Run
From the project root:
```bash
python backend/server.py
```
Open http://localhost:3000.

## Financial performance page and machine editing

- Added a dedicated **Financials** navigation page with live simulated production value earned, contribution opportunity loss, current hourly loss exposure, net estimated contribution, unit variance, machine-level capacity gap and a recent financial event ledger.
- The financial model accrues once per simulation tick (one simulated production minute). It uses the minimum current machine rate as line output, an editable planned rate, and an editable contribution-value-per-vehicle assumption.
- The financial values are scenario estimates, not actual cash income, audited loss, accounting profit or company revenue. The default ₹35,000 per vehicle is a placeholder and must be replaced with finance-approved plant data.
- Added an **Edit machine specifications** action on every machine card. It opens the engineering editor with that machine selected. All editable fields are validated and saved through the authenticated backend API; saved specifications update the simulation baseline and are persisted in SQLite.
- The machine upgrade editor now listens to changes in every editable field, including production stage, and surfaces server-side save failures in the page status as well as a toast.
