# PulseGrid — simulation assumptions and operator guidance

## Demo administrator
- Username: `admin`
- Password: `admin 123`

The local demo account is deliberately simple for the hackathon. The backend re-applies these credentials at startup and revokes prior sessions. Do not expose this build to a public network or use these credentials in a production environment. Set `PULSEGRID_ADMIN_USER` and `PULSEGRID_ADMIN_PASSWORD` to private values before any non-demo deployment.

## Random incident cadence
- The first synthetic incident is scheduled after a randomized 120–240 simulated minutes.
- After an incident is rectified, the next is scheduled 180–360 simulated minutes later.
- At most one random incident is active at a time.
- The browser simulation advances one model minute every 1.5 seconds, so these intervals are accelerated for demonstration. They are not a statistical reliability model.

## Fault response guidance
Reports now contain machine-specific checks plus fault-type checks. The suggestions are intended for the simulation and operator training. They do not replace OEM procedures, permits, electrical isolation, lockout/tagout, or competent maintenance personnel.

## Financial assumptions
The dashboard defaults to an illustrative contribution assumption of ₹8,000 per completed vehicle and a planned line rate of 46 vehicles/hour. These are editable demonstration inputs, not published Apex Motors figures or verified industry averages. The model smooths short-term telemetry noise and ignores small deviations within a 3% / 1.5-vehicle-per-hour normal band before estimating lost contribution. The dashboard reports estimated contribution, not revenue, cash income, or audited profit/loss.

For credible plant use, replace these assumptions with finance-approved contribution per good unit, scheduled shift targets, actual good-unit counts, scrap/rework costs, downtime and recovery records, inventory buffers, and MES/ERP data. Equipment ratings, temperatures, reliability and operating-hour values remain illustrative placeholders requiring validation against site/OEM documentation.
