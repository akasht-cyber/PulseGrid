# PulseGrid ⚡
**Smart Factory Machine Management, Fault Simulation & Biometric Authentication Platform**

PulseGrid is a full-stack industrial operations simulator designed to monitor factory machinery, simulate real-time operational faults and financial impacts, and enforce access control through biometric face-scan authentication.

---

## 🚀 Key Features
- **Biometric Access Control:** Secure login flow backed by face-scan verification (`login.html`, `face_scans.json`).
- **Real-Time Fault Simulator:** Dynamic generation of machine incidents and random faults to test operational resilience (`random_faults.js`).
- **Machine Upgrades & Operations:** Manage machine performance tiers, maintenance logs, and operational refinements (`control_log.json`).
- **Financial Impact Tracking:** Evaluates downtime costs, incident losses, and upgrade ROI across the factory floor.
- **Persistent Database Storage:** Lightweight SQLite backend (`pulsegrid.db`) paired with a custom Python server (`server.py`).

---

## 🛠️ Tech Stack
- **Backend:** Python (`server.py`), SQLite (`pulsegrid.db`)
- **Frontend:** HTML5, CSS3 (`style.css`), Vanilla JavaScript (`app.js`, `navigation.js`, `random_faults.js`)
- **Data & Logging:** JSON (`control_log.json`, `face_scans.json`)

---

## 📂 Project Structure
```text
PulseGrid/
├── index.html          # Main factory operations dashboard
├── login.html          # Biometric face-scan authentication portal
├── style.css           # UI styling and layout
├── app.js              # Core dashboard logic and state management
├── navigation.js       # Multi-view navigation handler
├── random_faults.js    # Fault and random incident simulation engine
├── server.py           # Python backend server & API endpoints
├── pulsegrid.db        # SQLite database for machines and operations
├── control_log.json    # System and operator activity logs
└── face_scans.json     # Biometric authentication records
```

---

## ⚙️ How to Run Locally
1. **Clone the repository:**
   ```bash
   git clone https://github.com
   cd PulseGrid
   ```
2. **Start the Python server:**
   ```bash
   python server.py
   ```
3. **Open in your browser:**
   Navigate to `http://localhost:8000` *(or the port printed in your terminal)*.

---

## 👨‍💻 Author
**Akash T** — BE CSE (Cyber Security) ’29 @ RNS Institute of Technology (RNSIT), Bengaluru  
- GitHub: [@akash9686](https://github.com)
