"""PulseGrid — single-site automotive plant monitoring backend.
Run from the project root: python backend/server.py
Open http://localhost:3000
"""
from __future__ import annotations
import hashlib, hmac, json, os, secrets, shutil, sqlite3, time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DATA = ROOT / "backend" / "data"
DATA.mkdir(parents=True, exist_ok=True)
DB = DATA / "pulsegrid.db"
HOST, PORT = "127.0.0.1", 3000
SESSION_SECONDS = 8 * 60 * 60
FACTORY = {"code":"APX-BLR-01", "name":"Apex Motors — Bengaluru Vehicle Assembly Plant", "location":"Bengaluru, Karnataka, India", "industry":"Automotive manufacturing", "product":"Passenger vehicles"}
# Illustrative engineering baselines for a mid-volume passenger-vehicle line.
# Capacities are vehicles/hour; thermal values are equipment sensor readings, not process recipes.
MACHINES = [
    ("furnace", "Body Stamping Press", "Body shop", 58, "APX-SP-2200", 55, 75, 90, 96, 420),
    ("mixer", "Body Welding Robot Cell", "Body shop", 56, "APX-WR-6AX", 48, 68, 82, 97, 680),
    ("convA", "Body Transfer Conveyor", "Body transfer", 60, "APX-BC-90", 42, 62, 76, 95, 510),
    ("press", "Paint Curing Oven", "Paint shop", 54, "APX-OV-180", 185, 205, 220, 94, 760),
    ("cooler", "Paint Cooling Tunnel", "Paint shop", 56, "APX-CT-60", 42, 58, 70, 95, 390),
    ("convB", "Final Assembly Conveyor", "Final assembly", 52, "APX-FAC-120", 45, 65, 80, 96, 610),
    ("packer", "End-of-Line Inspection & Dispatch", "Quality & dispatch", 50, "APX-EOL-VIS", 38, 55, 68, 98, 280),
]
MIME={".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".ico":"image/x-icon"}

def now(): return datetime.now(timezone.utc).isoformat(timespec="seconds")
def connect():
    c=sqlite3.connect(DB, timeout=10); c.row_factory=sqlite3.Row; c.execute("PRAGMA foreign_keys=ON"); return c
def pwd_hash(pwd, salt): return hashlib.pbkdf2_hmac("sha256", pwd.encode(), bytes.fromhex(salt), 600_000).hex()
def token_hash(token): return hashlib.sha256(token.encode()).hexdigest()
def init_db():
    # The previous prototype stored per-user factories and machine rows in a
    # different schema. Preserve that database as a backup before creating
    # the single-plant schema; never silently try to use incompatible tables.
    if DB.exists():
        probe=sqlite3.connect(DB)
        try:
            tables={r[0] for r in probe.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            machine_cols={r[1] for r in probe.execute("PRAGMA table_info(machines)")} if "machines" in tables else set()
            session_cols={r[1] for r in probe.execute("PRAGMA table_info(sessions)")} if "sessions" in tables else set()
            legacy=("machines" in tables and "name" not in machine_cols) or ("sessions" in tables and "admin_id" not in session_cols)
        finally:
            probe.close()
        if legacy:
            stamp=datetime.now().strftime("%Y%m%d-%H%M%S")
            backup=DB.with_name(f"pulsegrid_legacy_backup_{stamp}.db")
            shutil.copy2(DB,backup)
            DB.unlink()
            print(f"Previous multi-account database backed up to: {backup}")
    with connect() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS factory(id INTEGER PRIMARY KEY CHECK(id=1), code TEXT NOT NULL, name TEXT NOT NULL, location TEXT NOT NULL, industry TEXT NOT NULL, product TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS machines(
          machine_key TEXT PRIMARY KEY, name TEXT NOT NULL, stage TEXT NOT NULL, capacity REAL NOT NULL,
          factory_id INTEGER NOT NULL DEFAULT 1 REFERENCES factory(id),
          model TEXT NOT NULL DEFAULT 'Standard', temp_setpoint REAL NOT NULL DEFAULT 50,
          temp_warn REAL NOT NULL DEFAULT 70, temp_critical REAL NOT NULL DEFAULT 85,
          reliability REAL NOT NULL DEFAULT 95, operating_hours REAL NOT NULL DEFAULT 0,
          config_version INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL DEFAULT 1 REFERENCES admin(id), expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS control_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, machine_key TEXT NOT NULL, action TEXT NOT NULL, speed INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
        """)
        c.execute("INSERT OR IGNORE INTO factory(id,code,name,location,industry,product) VALUES(1,?,?,?,?,?)",(FACTORY["code"],FACTORY["name"],FACTORY["location"],FACTORY["industry"],FACTORY["product"]))
        # Migrate earlier prototype machine tables without discarding existing records.
        existing_cols={r[1] for r in c.execute("PRAGMA table_info(machines)")}
        migrations={
          "model":"TEXT NOT NULL DEFAULT 'Standard'",
          "temp_setpoint":"REAL NOT NULL DEFAULT 50",
          "temp_warn":"REAL NOT NULL DEFAULT 70",
          "temp_critical":"REAL NOT NULL DEFAULT 85",
          "reliability":"REAL NOT NULL DEFAULT 95",
          "operating_hours":"REAL NOT NULL DEFAULT 0",
          "config_version":"INTEGER NOT NULL DEFAULT 0",
        }
        for col,decl in migrations.items():
            if col not in existing_cols: c.execute(f"ALTER TABLE machines ADD COLUMN {col} {decl}")
        c.executemany("""INSERT OR IGNORE INTO machines
          (machine_key,name,stage,capacity,model,temp_setpoint,temp_warn,temp_critical,reliability,operating_hours,config_version)
          VALUES(?,?,?,?,?,?,?,?,?,?,0)""",MACHINES)
        # Seed realistic plant baselines once; subsequent administrator upgrades persist.
        for row in MACHINES:
            c.execute("""UPDATE machines SET name=?,stage=?,capacity=?,model=?,temp_setpoint=?,temp_warn=?,temp_critical=?,reliability=?,operating_hours=?,config_version=1
                         WHERE machine_key=? AND config_version=0""",
                      (row[1],row[2],row[3],row[4],row[5],row[6],row[7],row[8],row[9],row[0]))
        username=os.environ.get("PULSEGRID_ADMIN_USER","admin").strip() or "admin"
        # Fixed demo credentials requested for the hackathon build. Override via
        # environment variables before exposing this app beyond a local demo.
        password=os.environ.get("PULSEGRID_ADMIN_PASSWORD","admin 123")
        existing=c.execute("SELECT username FROM admin WHERE id=1").fetchone()
        salt=secrets.token_hex(16)
        if existing:
            c.execute("UPDATE admin SET username=?,password_hash=?,salt=? WHERE id=1",(username,pwd_hash(password,salt),salt))
            c.execute("DELETE FROM sessions")
        else:
            c.execute("INSERT INTO admin(id,username,password_hash,salt,created_at) VALUES(1,?,?,?,?)",(username,pwd_hash(password,salt),salt,now()))
        print("Administrator demo credentials set; any previous sessions were revoked.")
        c.execute("DELETE FROM sessions WHERE expires_at<=?",(int(time.time()),))

def session_user(token):
    if not token: return False
    with connect() as c:
        return bool(c.execute("SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?",(token_hash(token),int(time.time()))).fetchone())
def read_body(h):
    try:
        n=int(h.headers.get("Content-Length","0"))
        if n>100_000: raise ValueError()
        return json.loads(h.rfile.read(n) or b"{}")
    except Exception: raise ValueError("Invalid request body.")
def machine_dict(row):
    return {"id":row["machine_key"],"name":row["name"],"stage":row["stage"],"capacity":row["capacity"],
            "model":row["model"],"tempSetpoint":row["temp_setpoint"],"tempWarn":row["temp_warn"],
            "tempCritical":row["temp_critical"],"reliability":row["reliability"],
            "operatingHours":row["operating_hours"],"configVersion":row["config_version"]}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send(self,status,body,ctype="application/json; charset=utf-8"):
        raw=body if isinstance(body,bytes) else body.encode()
        self.send_response(status); self.send_header("Content-Type",ctype); self.send_header("Content-Length",str(len(raw))); self.send_header("Cache-Control","no-store"); self.send_header("X-Content-Type-Options","nosniff"); self.send_header("Referrer-Policy","same-origin"); self.send_header("X-Frame-Options","DENY"); self.end_headers(); self.wfile.write(raw)
    def js(self,status,obj): self.send(status,json.dumps(obj))
    def bearer(self):
        scheme,_,value=self.headers.get("Authorization","").partition(" ")
        return value.strip() if scheme.lower()=="bearer" else ""
    def do_POST(self):
        route=self.path.split("?",1)[0]
        try: data=read_body(self)
        except ValueError as e: return self.js(400,{"ok":False,"error":str(e)})
        if route=="/api/login":
            identity=str(data.get("identity",data.get("username",""))).strip()
            password=str(data.get("password",""))
            with connect() as c:
                row=c.execute("SELECT * FROM admin WHERE id=1 AND username=?",(identity,)).fetchone()
                if not row or not hmac.compare_digest(pwd_hash(password,row["salt"]),row["password_hash"]): return self.js(401,{"ok":False,"error":"Invalid administrator username or password."})
                token=secrets.token_urlsafe(40); c.execute("INSERT INTO sessions(token_hash,admin_id,expires_at,created_at) VALUES(?,1,?,?)",(token_hash(token),int(time.time())+SESSION_SECONDS,now()))
            return self.js(200,{"ok":True,"token":token,"admin":{"username":identity},"factory":FACTORY})
        if route=="/api/logout":
            tok=self.bearer()
            if tok:
                with connect() as c: c.execute("DELETE FROM sessions WHERE token_hash=?",(token_hash(tok),))
            return self.js(200,{"ok":True})
        if route=="/api/machine-config":
            if not session_user(self.bearer()): return self.js(401,{"ok":False,"error":"Administrator sign-in required."})
            if not isinstance(data,dict): return self.js(400,{"ok":False,"error":"Invalid configuration."})
            key=str(data.get("machine",""))
            try:
                name=str(data.get("name","")).strip()
                model=str(data.get("model","")).strip()
                stage=str(data.get("stage","")).strip()
                capacity=float(data.get("capacity"))
                setpoint=float(data.get("tempSetpoint"))
                warn=float(data.get("tempWarn"))
                critical=float(data.get("tempCritical"))
                reliability=float(data.get("reliability"))
                hours=float(data.get("operatingHours",0))
            except (TypeError,ValueError):
                return self.js(400,{"ok":False,"error":"All engineering fields must contain valid numbers."})
            if key not in {m[0] for m in MACHINES}: return self.js(404,{"ok":False,"error":"Unknown plant machine."})
            if not name or len(name)>90 or not model or len(model)>80 or not stage or len(stage)>60:
                return self.js(400,{"ok":False,"error":"Machine name, model and stage are required."})
            if not (1<=capacity<=200) or not (-20<=setpoint<=500) or not (setpoint<warn<critical<=550) or not (50<=reliability<=100) or not (0<=hours<=200000):
                return self.js(400,{"ok":False,"error":"Check capacity, temperature thresholds, reliability and operating-hour ranges."})
            with connect() as c:
                c.execute("""UPDATE machines SET name=?,stage=?,capacity=?,model=?,temp_setpoint=?,temp_warn=?,temp_critical=?,reliability=?,operating_hours=?,config_version=config_version+1 WHERE machine_key=?""",
                          (name,stage,capacity,model,setpoint,warn,critical,reliability,hours,key))
                row=c.execute("SELECT * FROM machines WHERE machine_key=?",(key,)).fetchone()
            return self.js(200,{"ok":True,"machine":machine_dict(row),"message":"Machine configuration saved. Simulation baseline recalculated."})
        if route=="/api/control":
            if not session_user(self.bearer()): return self.js(401,{"ok":False,"error":"Administrator session expired. Sign in again."})
            key=str(data.get("machine","")); action=str(data.get("action",""))
            if key not in {m[0] for m in MACHINES}: return self.js(404,{"ok":False,"error":"Unknown plant machine."})
            try:
                speed=max(0,min(100,int(data.get("value",100)))) if action=="speed" else (0 if action=="stop" else 100 if action=="start" else None)
            except (TypeError,ValueError): speed=None
            if speed is None: return self.js(400,{"ok":False,"error":"Invalid machine command."})
            with connect() as c: c.execute("INSERT INTO control_logs(machine_key,action,speed,created_at) VALUES(?,?,?,?)",(key,action,speed,now()))
            return self.js(200,{"ok":True,"machine":key,"speed":speed,"message":"Machine command authorized and recorded."})
        return self.js(404,{"ok":False,"error":"Endpoint not found."})
    def do_GET(self):
        route=self.path.split("?",1)[0]
        if route=="/api/health": return self.js(200,{"ok":True,"service":"PulseGrid plant monitor","factory":FACTORY["code"]})
        if route in ("/api/whoami","/api/factory","/api/machines","/api/machine-config","/api/control-logs"):
            if not session_user(self.bearer()): return self.js(401,{"ok":False,"error":"Administrator sign-in required."})
            if route=="/api/whoami": return self.js(200,{"ok":True,"admin":{"username":os.environ.get("PULSEGRID_ADMIN_USER","admin")},"factory":FACTORY})
            if route=="/api/factory": return self.js(200,{"ok":True,"factory":FACTORY})
            if route=="/api/machines" or route=="/api/machine-config":
                with connect() as c: rows=c.execute("SELECT * FROM machines ORDER BY rowid").fetchall()
                return self.js(200,{"ok":True,"machines":[machine_dict(r) for r in rows]})
            with connect() as c: rows=c.execute("SELECT machine_key,action,speed,created_at FROM control_logs ORDER BY id DESC LIMIT 100").fetchall()
            return self.js(200,{"ok":True,"logs":[dict(r) for r in rows]})
        rel=unquote(route.lstrip("/")) or "login.html"; target=(FRONTEND/rel).resolve()
        if not target.is_relative_to(FRONTEND.resolve()): return self.send(403,"Forbidden","text/plain")
        if target.is_file(): return self.send(200,target.read_bytes(),MIME.get(target.suffix.lower(),"application/octet-stream"))
        return self.send(404,"Not found","text/plain; charset=utf-8")
if __name__=="__main__":
    init_db(); print("="*58); print(" PulseGrid | Apex Motors Vehicle Assembly Plant"); print(f" Open http://localhost:{PORT}"); print(f" Database: {DB}"); print(" Stop with Ctrl+C"); print("="*58)
    try: ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
    except KeyboardInterrupt: print("\nServer stopped.")
