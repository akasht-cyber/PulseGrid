# PulseGrid — Apex Motors plant console

This build is configured for one fictional demonstration site:

- **Company:** Apex Motors
- **Plant:** Bengaluru Vehicle Assembly Plant
- **Plant code:** APX-BLR-01
- **Industry:** Automotive manufacturing
- **Product:** Passenger vehicles
- **Access model:** one designated plant administrator; no public registration or tenant creation

## Run

From the project root:

```bash
python backend/server.py
```

Open `http://localhost:3000`. Do not use Live Server for the authenticated application; the Python server serves both the frontend and API.

## First administrator login

On the first run, the backend creates one administrator account. The default username is `plant.admin`. A strong random password is generated and printed **once** in the terminal. Save it in a password manager. The password is stored as a salted PBKDF2-HMAC-SHA256 hash (600,000 iterations); the plaintext is not stored.

You can provide your own administrator credentials **before the first run**.

PowerShell:

```powershell
$env:PULSEGRID_ADMIN_USER = "plant.admin"
$env:PULSEGRID_ADMIN_PASSWORD = "Choose-A-Long-Unique-Password"
python backend/server.py
```

To reset credentials later, stop the server and run with:

```powershell
$env:PULSEGRID_ADMIN_USER = "plant.admin"
$env:PULSEGRID_ADMIN_PASSWORD = "Choose-A-New-Long-Unique-Password"
$env:PULSEGRID_RESET_ADMIN = "1"
python backend/server.py
```

The reset revokes all existing sessions. Remove the `PULSEGRID_RESET_ADMIN` variable after the reset.

## Included production assets

1. Body Stamping Press
2. Body Welding Robot Cell
3. Body Transfer Conveyor
4. Paint Curing Oven
5. Paint Cooling Tunnel
6. Final Assembly Conveyor
7. End-of-Line Inspection & Dispatch

The current readings, fault injection and production rates are **simulated demonstration data**. They are not connected to real PLCs, IoT sensors or factory equipment. The 3D plant view is a custom Canvas illustration, not an engineering-grade CAD model.

## Security notes

- The backend binds to `127.0.0.1` by default and is intended for local demonstration.
- The session token is random, stored hashed in SQLite, and expires after eight hours.
- Machine-control commands require a valid administrator session and are written to the local SQLite audit log.
- The database is created at `backend/data/pulsegrid.db`. Keep this file private; it contains the administrator hash, active sessions and control audit history.
- Do not expose this development server directly to the public internet. A public deployment needs HTTPS, stronger rate limiting, secure cookie/session handling, CSRF protection where applicable, backups and production server hardening.
