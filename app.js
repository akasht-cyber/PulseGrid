/* ============ PulseGrid — app.js ============ */
/* Simulation model, alert/prediction engine, rendering, controls.
   Team tip: simulation logic lives in sections 1–3, UI in sections 4–6. */

/* ============ 1. MODEL ============ */
const FLOW = ['furnace','mixer','convA','press','cooler','convB','packer'];
const PLANT_NAME = 'Apex Motors — Bengaluru Vehicle Assembly Plant';
const M = {
  furnace:{name:'Body Stamping Press', icon:'▤', base:58, temp:55, baseTemp:55, tempSetpoint:55, tempWarn:75, tempCritical:90, tRange:[20,110], showTemp:true, model:'APX-SP-2200', reliability:96, operatingHours:420},
  mixer:  {name:'Body Welding Robot Cell', icon:'⚙', base:56, temp:48, baseTemp:48, tempSetpoint:48, tempWarn:68, tempCritical:82, tRange:[20,100], showTemp:true, model:'APX-WR-6AX', reliability:97, operatingHours:680},
  convA:  {name:'Body Transfer Conveyor', icon:'⇢', base:60, temp:42, baseTemp:42, tempSetpoint:42, tempWarn:62, tempCritical:76, tRange:[15,90], showTemp:true, model:'APX-BC-90', reliability:95, operatingHours:510},
  press:  {name:'Paint Curing Oven', icon:'♨', base:54, temp:185, baseTemp:185, tempSetpoint:185, tempWarn:205, tempCritical:220, tRange:[120,260], showTemp:true, model:'APX-OV-180', reliability:94, operatingHours:760},
  cooler: {name:'Paint Cooling Tunnel', icon:'❄', base:56, temp:42, baseTemp:42, tempSetpoint:42, tempWarn:58, tempCritical:70, tRange:[15,100], showTemp:true, model:'APX-CT-60', reliability:95, operatingHours:390},
  convB:  {name:'Final Assembly Conveyor', icon:'⇢', base:52, temp:45, baseTemp:45, tempSetpoint:45, tempWarn:65, tempCritical:80, tRange:[15,100], showTemp:true, model:'APX-FAC-120', reliability:96, operatingHours:610},
  packer: {name:'End-of-Line Inspection & Dispatch', icon:'✓', base:50, temp:38, baseTemp:38, tempSetpoint:38, tempWarn:55, tempCritical:68, tRange:[10,90], showTemp:true, model:'APX-EOL-VIS', reliability:98, operatingHours:280},
};
FLOW.forEach(id => { M[id].speed = 100; M[id].eff = 1; M[id].rate = M[id].base; M[id].hist = []; M[id].dev = 0; M[id].tempHist = []; });
window.M = M;
window.pushAlert = pushAlert;
const JUNCTIONS = FLOW.length - 1;          // queues between consecutive machines
let wip = Array(JUNCTIONS).fill(0);
let wipHist = Array(JUNCTIONS).fill(0).map(()=>[]);
let wipAvg = Array(JUNCTIONS).fill(0);
let powerLoad = 62, powerFaultActive = false;
let tick = 0, paused = false;
let faults = { cooler:false, jam:false };
const TICK_MIN = 1/60;                       // rates are vehicles/hour; one tick represents one simulated minute
const finance = { earned:0, lost:0, produced:0, missed:0, ledger:[], lastLossState:false, smoothedRate:null };
const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Math.max(0,value||0));
let alerts = [];                             // {level,title,msg,fix,tick}
let alertKeys = {};                          // dedupe/cooldown
const ALERT_COOLDOWN = 6;

const rnd = (a,b)=> a + Math.random()*(b-a);
const clamp = (v,a,b)=> Math.max(a, Math.min(b, v));

/* ---------- 🔊 voice announcements (built into the browser, no internet needed) ---------- */
let voiceOn = localStorage.getItem('pg_voice') !== 'off';
const voiceLast = {};                    // spoken-message cooldown per event key
const VOICE_COOLDOWN = 45;               // ticks (~68s) before repeating the same voice alert

function speak(text){
  if (!voiceOn || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();            // don't queue up a backlog during a crisis
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 1; u.volume = 1;
    speechSynthesis.speak(u);
  } catch(e){ /* voice not available -> silent fallback */ }
}
function speakOnce(key, text){
  if (tick - (voiceLast[key] || -9999) < VOICE_COOLDOWN) return;
  voiceLast[key] = tick;
  speak(text);
}
/* ---------- toast popups for the admin ---------- */
function toast(html, level){
  const t = document.createElement('div');
  t.className = 'toast ' + (level || 'warn');
  t.innerHTML = html;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 30);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4200);
}
const toastLast = {};
function toastOnce(key, html, level){
  if (tick - (toastLast[key] || -9999) < 8) return;   // max 1 popup per event per ~12s
  toastLast[key] = tick;
  toast(html, level);
}

function efficiency(id){
  const m = M[id];
  let eff = 1;
  if (m.showTemp){
    const excess = Math.max(0, m.temp - m.tempWarn);
    if (excess > 0) eff -= excess * 0.012;
    // Aging equipment has a modest reliability derate; a replacement can improve this.
    eff *= (0.94 + (m.reliability - 90) * 0.01);
    eff = clamp(eff, 0.35, 1);
  }
  if (id === 'convA' && faults.jam) eff *= 0.35;
  // Power derating is applied once in the throughput calculation below.
  m.eff = clamp(eff, 0.3, 1);
}

function financePlan(){ return clamp(Number(document.getElementById('financePlanRate')?.value)||46,1,200); }
function financeMargin(){ return clamp(Number(document.getElementById('financeMargin')?.value)||8000,1,10000000); }
function currentLineRate(){
  const rates=FLOW.map(id=>Number.isFinite(M[id].rate)?Math.max(0,M[id].rate):0);
  return Math.min(...rates);
}
function updateFinancials(accrue=false){
  const plan=financePlan(), rawActual=currentLineRate(), margin=financeMargin();
  // Smooth per-machine telemetry noise and tolerate a small normal operating band.
  if(rawActual<=0) finance.smoothedRate=0;
  else if(!Number.isFinite(finance.smoothedRate)) finance.smoothedRate=rawActual;
  else if(accrue) finance.smoothedRate=finance.smoothedRate*0.8+rawActual*0.2;
  const actual=finance.smoothedRate;
  const normalBand=Math.max(1.5,plan*0.03);
  const shortfall=Math.max(0,plan-actual-normalBand), exposure=shortfall*margin;
  if(accrue){
    finance.produced += actual*TICK_MIN;
    finance.missed += shortfall*TICK_MIN;
    finance.earned += actual*TICK_MIN*margin;
    finance.lost += shortfall*TICK_MIN*margin;
    const isLoss=shortfall>0;
    if(isLoss!==finance.lastLossState){
      finance.ledger.unshift({tick,kind:isLoss?'LOSS':'RECOVERY',text:isLoss?'Material production shortfall detected':'Production returned within normal operating band',rate:actual,shortfall,value:shortfall*TICK_MIN*margin});
      finance.ledger=finance.ledger.slice(0,30); finance.lastLossState=isLoss;
    }
  }
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
  set('finEarned',money(finance.earned)); set('finLost',money(finance.lost)); set('finExposure',money(exposure)+'/hr');
  set('finNet',money(finance.earned-finance.lost)); set('finPlan',plan.toFixed(1)+' vehicles/hr');
  set('finActual',actual.toFixed(1)+' vehicles/hr'); set('finShortfall',shortfall.toFixed(1)+' vehicles/hr');
  set('finUnits',finance.produced.toFixed(2)); set('finMissed',finance.missed.toFixed(2));
  const progress=document.getElementById('finProgress'); if(progress)progress.style.width=clamp(actual/plan*100,0,100)+'%';
  const breakdown=document.getElementById('finMachineBreakdown');
  if(breakdown) breakdown.innerHTML=FLOW.map(id=>{const m=M[id], gap=Math.max(0,m.base*(m.reliability/100)-m.rate), value=gap*margin;return {name:m.name,gap,value};}).sort((a,b)=>b.value-a.value).map(x=>`<div class="finance-breakdown-row"><span>${x.name}</span><b>${x.gap.toFixed(1)} /hr</b><em>${money(x.value)}/hr</em></div>`).join('');
  const ledger=document.getElementById('finLedger');
  if(ledger) ledger.innerHTML=finance.ledger.length?finance.ledger.map(e=>`<div class="finance-ledger-event"><span class="${e.kind==='LOSS'?'loss-text':'gain-text'}">${e.kind}</span><b>${e.text}</b><small>Shift ${String(Math.floor(e.tick/60)).padStart(2,'0')}:${String(e.tick%60).padStart(2,'0')} · ${e.rate.toFixed(1)} vehicles/hr</small><strong>${e.kind==='LOSS'?money(e.value)+' estimated / min':'Output recovered'}</strong></div>`).join(''):'<p>No production variance recorded yet.</p>';
  set('finLedgerCount',finance.ledger.length+' events');
}
function resetFinancials(){finance.earned=0;finance.lost=0;finance.produced=0;finance.missed=0;finance.ledger=[];finance.lastLossState=false;finance.smoothedRate=currentLineRate();updateFinancials(false);}

function doTick(){
  tick++; window.tick = tick;
  if (window.PulseGridRandomFaults) window.PulseGridRandomFaults.onTick();
  // power
  // Manual faults are latched and remain active until the operator resolves them.
  powerLoad = powerFaultActive ? 92 + rnd(-2,2) : 62 + rnd(-4,4);
  const powerFactor = powerFaultActive ? 0.8 : 1;

  // temps
  FLOW.forEach(id=>{ const m=M[id]; if(!m.showTemp) return;
    const forcedHeat = id==='cooler' && faults.cooler;
    m.temp = forcedHeat
      ? clamp(m.temp+1.2+rnd(-0.2,0.2),m.tRange[0],m.tRange[1])
      : m.temp + (m.baseTemp-m.temp)*0.06 + rnd(-0.22,0.22);
  });

  // speeds & efficiency
  FLOW.forEach(id => { efficiency(id); });
  M.convB.speed = convB_speed;               // user-applied what-if setting
  if (faults.jam && !M.convA.stopped) M.convA.speed = 100; // the jam fault applies a 65% efficiency loss
  // Apply active operator incidents AFTER all normal/user controls. This makes
  // the incident authoritative on every tick until the operator rectifies it.
  if (window.PulseGridRandomFaults) window.PulseGridRandomFaults.applyToMachines();

  // rates
  FLOW.forEach(id => {
    const m = M[id];
    const rawRate=m.stopped ? 0 : m.base * (m.speed/100) * m.eff * powerFactor + rnd(-2,2);
    m.rate = Number.isFinite(rawRate) ? clamp(rawRate, 0, m.base*1.05) : 0;
    m.hist.push(m.rate); if (m.hist.length > 40) m.hist.shift();
    m.dev = m.showTemp ? (m.temp - m.baseTemp) : 0;
    // strain tracking (machine taking more load than it can comfortably handle)
    m.strainTicks = (m.eff < 0.92) ? (m.strainTicks || 0) + 1 : 0;
  });

  // Financial ledger accrues one simulated minute of estimated output and shortfall.
  updateFinancials(true);

  // queues (WIP)
  for (let i=0;i<JUNCTIONS;i++){
    const up = M[FLOW[i]].rate, down = M[FLOW[i+1]].rate;
    wip[i] = clamp(wip[i] + (up - down)*TICK_MIN, 0, 400);
    wipHist[i].push(wip[i]); if (wipHist[i].length > 40) wipHist[i].shift();
    wipAvg[i] = wipAvg[i]*0.92 + wip[i]*0.08;
  }

  detectAlerts();
  render();
}

/* ============ 2. ALERTS / PREDICTION ============ */
function pushAlert(key, level, title, msg, fix){
  const now = tick;
  if (alertKeys[key] && now - alertKeys[key] < ALERT_COOLDOWN) return;
  alertKeys[key] = now;
  alerts.unshift({level, title, msg, fix, tick: now});
  if (alerts.length > 14) alerts.pop();
}

function detectAlerts(){
  // HEATING: machine running hot
  const c = M.cooler;
  FLOW.forEach(id => {
    const m = M[id];
    if (!m.showTemp) return;
    if (m.temp >= m.tempWarn){
      const critical = m.temp >= m.tempCritical;
      const dropPct = Math.round((1 - m.eff) * 100);
      pushAlert('heat_'+id, critical?'crit':'warn', m.name + ' temperature high (' + m.temp.toFixed(1) + '°C)',
        m.name + ' sensor is reading ' + m.temp.toFixed(1) + '°C against a configured warning limit of ' + m.tempWarn + '°C and critical limit of ' + m.tempCritical + '°C. Estimated capacity derate: ' + dropPct + '%.',
        'Inspect cooling, lubrication, load and sensor calibration; compare with the machine manufacturer specification.');
      speakOnce('heat_'+id, 'Warning. ' + m.name + ' temperature is ' + Math.round(m.dev) + ' degrees above normal.');
      toastOnce('heat_'+id, '🌡️ <b>' + m.name + ' heating</b> +' + m.dev.toFixed(1) + '°C above normal', m.temp>=m.tempCritical?'crit':'warn');
    }
  });
  // HEAVY LOAD: machine straining (efficiency penalty active for several minutes)
  FLOW.forEach(id => {
    const m = M[id];
    if ((m.strainTicks || 0) > 4){
      pushAlert('load_'+id, 'warn', m.name + ' under heavy load',
        m.name + ' efficiency is down to ' + Math.round(m.eff*100) + '% — it is taking more load than it can comfortably handle.',
        'Reduce upstream feed or rebalance the line');
      speakOnce('load_'+id, 'Caution. ' + m.name + ' is under heavy load.');
      toastOnce('load_'+id, '⚡ <b>' + m.name + ' under heavy load</b> — efficiency ' + Math.round(m.eff*100) + '%', 'warn');
    }
  });
  // PREDICTION: estimate time to the configured critical temperature for every instrumented asset.
  FLOW.forEach(id=>{
    const m=M[id]; if(!m.showTemp) return;
    m.tempHist.push(m.temp); if(m.tempHist.length>12)m.tempHist.shift();
    if(m.tempHist.length>=10){
      const slope=(m.tempHist[m.tempHist.length-1]-m.tempHist[0])/(m.tempHist.length-1);
      if(slope>0.15 && m.temp<m.tempCritical && m.temp>=m.tempWarn-5){
        const mins=Math.max(1,Math.round((m.tempCritical-m.temp)/slope));
        if(mins<=60){
          const downstream=FLOW.slice(FLOW.indexOf(id)+1);
          pushAlert('pred_'+id,'warn','Predicted thermal limit: '+m.name+' in ~'+mins+' min',
            m.name+' is warming at '+slope.toFixed(2)+'°C per simulated minute. At its configured critical limit ('+m.tempCritical+'°C), modeled capacity will be derated and downstream stages may be starved.',
            'Schedule inspection of cooling, lubrication and load; review downstream WIP and follow OEM safe operating limits.');
        }
      }
    }
  });
  // jams
  if (faults.jam){
    pushAlert('jam','crit','Body Transfer Conveyor jammed','Body transfer stopped moving vehicle bodies. The Stamping Press and Welding Robot Cell continue producing, so work-in-progress accumulates upstream; the Paint Shop, Final Assembly and End-of-Line stages are starved.','Dispatch maintenance team');
    speakOnce('jam', 'Critical. Body transfer conveyor jammed. Dispatch maintenance team and stop upstream feed if the queue limit is reached.');
    toastOnce('jam', '⛔ <b>Body transfer conveyor jammed</b><br>Downstream stages are being starved', 'crit');
  }
  // power
  if (powerFaultActive){
    pushAlert('power','warn','Power dip detected','Line-wide speed reduced ~20%. All machines show high load.','Shift non-critical load / start backup generator');
    speakOnce('power', 'Warning. Power dip detected. Line speed reduced.');
    toastOnce('power', '🔌 <b>Power dip detected</b> — line speed reduced ~20%', 'warn');
  }
  // hidden inefficiency: persistent queue
  for (let i=0;i<JUNCTIONS;i++){
    if (wipAvg[i] > 55 && wip[i] > 60){
      const between = M[FLOW[i]].name + ' → ' + M[FLOW[i+1]].name;
      pushAlert('wip'+i, 'warn', 'Hidden inefficiency: queue before ' + M[FLOW[i+1]].name,
        between + ' — ' + Math.round(wip[i]) + ' vehicles in queue. Upstream is consistently faster than downstream.',
        'Rebalance: match upstream speed to ' + Math.round(M[FLOW[i+1]].rate / M[FLOW[i]].base * 100) + '%');
    }
  }
  // starvation downstream
  if (wip[3] < 2 && tick > 10 && c.temp >= c.tempWarn){
    pushAlert('starve','info','Downstream starvation','Paint Cooling Tunnel slowdown is reducing the feed to Final Assembly and End-of-Line Inspection.','');
  }
}

/* ============ 3. WHAT-IF ============ */
let convB_speed = 100;
function projectedOutput(){
  let min = Infinity;
  FLOW.forEach(id=>{
    let speed = M[id].speed;
    if (id==='convB') speed = convB_speed;
    let eff = M[id].eff;
    if (id==='convB') eff = 1; // projection assumes no temp penalty changes
    const r = M[id].base * (speed/100) * eff * (powerFaultActive?0.8:1);
    if (r < min) min = r;
  });
  return min;
}
function updateProjection(){
  const cur = M.packer.rate, proj = projectedOutput();
  $('#projOut').textContent = Math.round(proj) + ' vehicles/hr';
  const d = Math.round(proj - cur);
  const pct = cur>0 ? Math.round(d/cur*100) : 0;
  const el = $('#projDelta');
  el.className = d>1 ? 'delta-up' : d<-1 ? 'delta-dn' : 'delta-flat';
  el.textContent = (d>0?'+':'') + d + ' vehicles/hr (' + (pct>0?'+':'') + pct + '%) vs current';
  $('#projNote').innerHTML = 'With Final Assembly Conveyor at <b>'+convB_speed+'%</b>, the queue before End-of-Line Inspection ' +
    (convB_speed<85 ? 'drains and absorbs cooling-tunnel slowdowns, but output dips ~'+Math.round((100-convB_speed)*0.5)+'%.'
     : convB_speed>100 ? 'rises.' : 'stays balanced.');
}

/* ============ 4. RENDER ============ */
const $ = s => document.querySelector(s);
const elCards = {}, elEdges = {}, elNodes = {};
function statusOf(id){
  const m = M[id];
  if (m.stopped) return 'crit';
  if (id==='convA' && faults.jam) return 'crit';
  if (m.showTemp && m.temp >= m.tempCritical) return 'crit';
  if (m.showTemp && m.temp >= m.tempWarn) return 'warn';
  if (powerFaultActive) return 'warn';
  return 'ok';
}
const BADGE = {ok:'OK', warn:'WARNING', crit:'CRITICAL'};

/* ============ 4A. INTERACTIVE 3D FACTORY ============ */
const factoryStations = FLOW.map((id, i) => ({id, x:0.7 + i*1.65}));
const factoryHeights = {furnace:1.35,mixer:1.05,convA:.48,press:1.3,cooler:1.05,convB:.48,packer:.95};
let selectedFactoryMachine = 'furnace';
let factoryCanvas, factoryCtx, factoryWidth=0, factoryHeight=0, factoryResizeObserver;
let factoryYaw=-0.22, factoryPitch=.72, factoryZoom=1, factoryPointer=null;
let factoryFrameTime=0, factoryVisualTime=0, factoryCenters={};

function factoryColor(id){
  const st = statusOf(id);
  return st==='crit' ? '#ff5d5d' : st==='warn' ? '#f5b942' : '#38d6e0';
}
function factoryColorMix(hex, factor){
  const n=parseInt(hex.slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  const scale=v=>Math.round(clamp(v*factor,0,255));
  return 'rgb('+scale(r)+','+scale(g)+','+scale(b)+')';
}
function buildFactoryView(){
  factoryCanvas=$('#factoryCanvas');
  factoryCtx=factoryCanvas.getContext('2d');
  $('#factoryMachines').innerHTML=FLOW.map(id=>'<button type="button" class="factory-machine" data-machine="'+id+'" aria-pressed="false">'+
    '<span class="factory-machine-icon">'+M[id].icon+'</span><span class="factory-machine-name">'+M[id].name+'</span><i class="factory-machine-light"></i></button>').join('');
  $('#factoryMachines').addEventListener('click', e=>{
    const btn=e.target.closest('[data-machine]');
    if(btn) selectFactoryMachine(btn.dataset.machine);
  });
  $('#factoryResetView').onclick=()=>{factoryYaw=-.22; factoryPitch=.72; factoryZoom=1;};
  factoryCanvas.addEventListener('pointerdown',e=>{
    factoryPointer={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};
    factoryCanvas.setPointerCapture(e.pointerId); factoryCanvas.classList.add('dragging');
  });
  factoryCanvas.addEventListener('pointermove',e=>{
    if(!factoryPointer || factoryPointer.id!==e.pointerId) return;
    const dx=e.clientX-factoryPointer.lastX, dy=e.clientY-factoryPointer.lastY;
    if(Math.abs(e.clientX-factoryPointer.x)+Math.abs(e.clientY-factoryPointer.y)>4) factoryPointer.moved=true;
    factoryYaw+=dx*.008; factoryPitch=clamp(factoryPitch+dy*.006,.28,1.3);
    factoryPointer.lastX=e.clientX; factoryPointer.lastY=e.clientY;
  });
  const endPointer=e=>{
    if(!factoryPointer || factoryPointer.id!==e.pointerId) return;
    const moved=factoryPointer.moved; factoryPointer=null; factoryCanvas.classList.remove('dragging');
    if(!moved && e.type==='pointerup'){const r=factoryCanvas.getBoundingClientRect(); selectFactoryAt(e.clientX-r.left,e.clientY-r.top);}
  };
  factoryCanvas.addEventListener('pointerup',endPointer);
  factoryCanvas.addEventListener('pointercancel',endPointer);
  factoryCanvas.addEventListener('wheel',e=>{e.preventDefault(); factoryZoom=clamp(factoryZoom*(e.deltaY<0?1.08:.92),.65,1.65);},{passive:false});
  if(window.ResizeObserver){factoryResizeObserver=new ResizeObserver(resizeFactoryCanvas);factoryResizeObserver.observe(factoryCanvas);}
  else window.addEventListener('resize',resizeFactoryCanvas);
  resizeFactoryCanvas();
  requestAnimationFrame(drawFactoryFrame);
}
function resizeFactoryCanvas(){
  if(!factoryCanvas || !factoryCtx) return;
  const rect=factoryCanvas.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
  factoryWidth=rect.width; factoryHeight=rect.height;
  factoryCanvas.width=Math.round(factoryWidth*dpr); factoryCanvas.height=Math.round(factoryHeight*dpr);
  factoryCtx.setTransform(dpr,0,0,dpr,0,0);
}
function factoryProject(x,y,z){
  const dx=x-5.65, dy=y;
  const rx=dx*Math.cos(factoryYaw)-dy*Math.sin(factoryYaw);
  const ry=dx*Math.sin(factoryYaw)+dy*Math.cos(factoryYaw);
  const scale=Math.min(factoryWidth/12.9,factoryHeight/6.1)*factoryZoom;
  return {x:factoryWidth*.5+rx*scale,y:factoryHeight*.55-(ry*Math.cos(factoryPitch)-z*Math.sin(factoryPitch))*scale,scale,depth:-ry*Math.sin(factoryPitch)+z*Math.cos(factoryPitch)};
}
function drawFactoryPolygon(points,fill,stroke,weight=1){
  const c=factoryCtx; c.beginPath(); c.moveTo(points[0].x,points[0].y);
  for(let i=1;i<points.length;i++) c.lineTo(points[i].x,points[i].y);
  c.closePath(); c.fillStyle=fill; c.fill();
  if(stroke){c.strokeStyle=stroke;c.lineWidth=weight;c.stroke();}
}
function drawFactoryBox(x,y,z,w,d,h,color,options={}){
  const c=factoryCtx;
  const v=[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],
    [x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]].map(p=>factoryProject(...p));
  const faces=[{ix:[0,1,5,4],shade:.57},{ix:[1,2,6,5],shade:.72},{ix:[2,3,7,6],shade:.48},
    {ix:[3,0,4,7],shade:.63},{ix:[4,5,6,7],shade:1.18}];
  faces.sort((a,b)=>a.ix.reduce((s,i)=>s+v[i].depth,0)-b.ix.reduce((s,i)=>s+v[i].depth,0));
  c.save();
  if(options.glow){c.shadowColor=options.glow;c.shadowBlur=options.blur||16;}
  faces.forEach(f=>drawFactoryPolygon(f.ix.map(i=>v[i]),factoryColorMix(color,f.shade),options.stroke||'rgba(122,166,195,.2)',.7));
  c.restore();
  return v;
}
function drawFactoryFloor(){
  const c=factoryCtx;
  drawFactoryBox(-.5,-1.65,-.25,12.3,3.3,.16,'#142331',{stroke:'rgba(87,132,163,.24)'});
  c.save(); c.strokeStyle='rgba(78,122,151,.16)'; c.lineWidth=.7;
  for(let x=0;x<=12;x+=1){const a=factoryProject(x,-1.55,-.08),b=factoryProject(x,1.55,-.08);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
  for(let y=-1.5;y<=1.5;y+=.5){const a=factoryProject(-.4,y,-.08),b=factoryProject(11.9,y,-.08);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
  c.restore();
}
function drawFactoryMachine(station){
  const {id,x}=station, h=factoryHeights[id], st=statusOf(id), color=factoryColor(id), selected=id===selectedFactoryMachine;
  const belt=id==='convA'||id==='convB', body=belt?'#344858':'#26394a';
  drawFactoryBox(x-.56,-.57,.02,1.12,1.14,h,body,{glow:selected?color:st==='ok'?null:color,blur:selected?17:12,stroke:selected?'rgba(56,214,224,.7)':'rgba(153,188,208,.28)'});
  if(belt){
    drawFactoryBox(x-.48,-.42,h+.03,.96,.84,.08,'#1b2c39',{stroke:'rgba(56,214,224,.55)'});
    for(let k=0;k<4;k++) drawFactoryBox(x-.4+k*.25,-.08,h+.12,.1,.18,.07,'#38d6e0');
  } else {
    drawFactoryBox(x-.42,-.55,h*.66,.84,.1,.07,color,{glow:color,blur:7,stroke:color});
    if(id==='furnace'){ drawFactoryBox(x-.2,-.12,h,.4,.42,.54,'#596f80',{stroke:'rgba(170,203,220,.6)'}); drawFactoryBox(x-.29,-.12,h+.48,.58,.12,.12,'#91a7b6',{stroke:'rgba(207,224,235,.55)'}); drawFactoryBox(x-.08,-.1,h+.12,.16,.18,.32,'#bdcbd3'); }
    if(id==='mixer'){ drawFactoryBox(x-.25,-.2,h,.5,.52,.22,'#40566a',{stroke:'rgba(56,214,224,.4)'}); drawFactoryBox(x-.04,-.08,h+.22,.08,.08,.48,'#9eb4c2'); drawFactoryBox(x-.04,-.08,h+.64,.34,.08,.08,'#9eb4c2'); drawFactoryBox(x+.24,-.08,h+.56,.08,.08,.18,'#d1a96a'); }
    if(id==='press'){
      drawFactoryBox(x-.43,-.47,h+.1,.86,.92,.08,'#6c4939',{glow:'#ef9659',blur:8,stroke:'rgba(239,150,89,.7)'});
      drawFactoryBox(x-.34,-.15,h,.68,.3,.22,'#667c8d',{stroke:'rgba(170,203,220,.45)'});
      drawFactoryBox(x-.12,-.02,h*.68,.24,.24,.36,'#94a8b7',{stroke:'rgba(207,224,235,.45)'});
    }
    if(id==='cooler'){
      drawFactoryBox(x-.34,-.46,h*.6,.68,.12,.32,'#314c5c',{stroke:'rgba(56,214,224,.5)'});
      const fan=factoryProject(x,-.6,h*.76), r=factoryProject(x+.18,-.6,h*.76).x-fan.x;
      factoryCtx.beginPath();factoryCtx.arc(fan.x,fan.y,Math.max(3,Math.abs(r)),0,Math.PI*2);
      factoryCtx.strokeStyle='rgba(56,214,224,.75)';factoryCtx.lineWidth=1.5;factoryCtx.stroke();
    }
    if(id==='packer'){ drawFactoryBox(x-.38,-.2,h,.76,.42,.5,'#344e5d',{stroke:'rgba(120,190,205,.5)'}); drawFactoryBox(x-.3,-.18,h+.5,.6,.08,.08,'#91c4ce'); for(let k=0;k<3;k++)drawFactoryBox(x-.27+k*.25,-.08,h+.58,.08,.08,.08,'#d5e5e9'); }
  }
  drawFactoryBox(x+.39,-.49,h+.06,.13,.13,.13,color,{glow:color,blur:8,stroke:color});
  const label=factoryProject(x,0,h+.3), c=factoryCtx;
  c.save(); c.textAlign='center'; c.font='600 10px Segoe UI, sans-serif'; c.fillStyle=selected?'#e7fbff':'#bdcedb';
  c.shadowColor='#09131c'; c.shadowBlur=5; c.fillText(M[id].name,label.x,label.y); c.restore();
  const pick=factoryProject(x,0,h*.45); factoryCenters[id]={x:pick.x,y:pick.y,scale:pick.scale};
}
function selectFactoryAt(x,y){
  let nearest=null, dist=Infinity;
  FLOW.forEach(id=>{const p=factoryCenters[id];if(!p)return;const d=Math.hypot(p.x-x,p.y-y);if(d<dist){dist=d;nearest=id;}});
  if(nearest && dist<Math.max(44,factoryCenters[nearest].scale*1.15)) selectFactoryMachine(nearest);
}
function selectFactoryMachine(id){selectedFactoryMachine=id;renderFactoryDetails();}
function renderFactoryDetails(){
  if(!$('#factoryDetailName')) return;
  const id=selectedFactoryMachine, i=FLOW.indexOf(id), m=M[id], st=statusOf(id), statusEl=$('#factoryDetailStatus');
  $('#factoryDetailName').textContent=m.name;
  statusEl.textContent=BADGE[st]; statusEl.className='factory-detail-status'+(st==='warn'?' warning':st==='crit'?' critical':'');
  $('#factoryDetailOutput').textContent=Math.round(m.rate)+' vehicles/hr';
  $('#factoryDetailQueue').textContent=i<JUNCTIONS?Math.round(wip[i])+' units':'Final stage';
  $('#factoryTempRow').style.display=m.showTemp?'flex':'none';
  if(m.showTemp) $('#factoryDetailTemp').textContent=Math.round(m.temp)+'°C';
  FLOW.forEach(machine=>{
    const btn=$('#factoryMachines [data-machine="'+machine+'"]');
    if(btn){const s=statusOf(machine);btn.classList.toggle('warning',s==='warn');btn.classList.toggle('critical',s==='crit');btn.setAttribute('aria-pressed',machine===id?'true':'false');}
  });
}
function drawFactoryFrame(now){
  if(!factoryCtx || !factoryWidth || !factoryHeight){requestAnimationFrame(drawFactoryFrame);return;}
  if(factoryFrameTime && !paused) factoryVisualTime+=(now-factoryFrameTime)/1000;
  factoryFrameTime=now;
  const c=factoryCtx; c.clearRect(0,0,factoryWidth,factoryHeight); factoryCenters={};
  drawFactoryFloor();
  // Connectors between stations make the production path visible in 3D.
  for(let i=0;i<factoryStations.length-1;i++){
    const a=factoryStations[i].x+.57,b=factoryStations[i+1].x-.57;
    drawFactoryBox(a,-.38,-.02,b-a,.76,.18,'#1c2c39',{stroke:'rgba(62,100,128,.38)'});
    drawFactoryBox(a,-.31,.17,b-a,.62,.035,'#263a49',{stroke:'rgba(56,214,224,.24)'});
  }
  factoryStations.forEach(drawFactoryMachine);
  // Small parts move along the line while the simulation is running.
  const lineStopped=FLOW.every(id=>M[id].stopped);
  if(!paused && !lineStopped){
    for(let i=0;i<7;i++){
      const x=.35+((factoryVisualTime*.55+i*1.72)%11.15);
      let nearest=factoryStations[0];
      factoryStations.forEach(s=>{if(Math.abs(s.x-x)<Math.abs(nearest.x-x)) nearest=s;});
      const z=Math.abs(nearest.x-x)<.68?factoryHeights[nearest.id]+.05:.26;
      drawFactoryBox(x,-.11,z,.2,.22,.18,i%3===0?'#8ba5b5':'#38d6e0',{glow:i%3===0?'rgba(139,165,181,.4)':'rgba(56,214,224,.45)',blur:5,stroke:'rgba(211,239,248,.45)'});
    }
  }
  requestAnimationFrame(drawFactoryFrame);
}

function buildGrid(){
  const g = $('#machineGrid');
  FLOW.forEach(id=>{
    const m = M[id];
    const d = document.createElement('div');
    d.className='card'; d.id='card_'+id;
    d.innerHTML =
      '<div class="top"><span class="icon">'+m.icon+'</span><span class="name">'+m.name+'</span>'+
      '<span class="badge ok" id="badge_'+id+'">OK</span></div>'+
      '<div class="row"><span>Output</span><b id="rate_'+id+'">—</b></div>'+
      '<div class="bar"><i id="barRate_'+id+'" style="background:var(--cyan)"></i></div>'+
      (m.showTemp ?
        '<div class="row" style="margin-top:8px"><span>Temp</span><b id="temp_'+id+'">—</b></div>'+
        '<div class="bar"><i id="barTemp_'+id+'" style="background:var(--orange)"></i></div>' : '') +
      '<div class="spark" id="spark_'+id+'"></div>'+
      '<button type="button" class="machine-edit-btn" data-edit-machine="'+id+'">Edit machine specifications</button>'+
      '<div class="ctrl" id="ctrl_'+id+'" style="display:none">'+
        '<div class="row" style="margin-top:8px"><span>⚙️ Admin speed</span><b id="sp_'+id+'">100%</b></div>'+
        '<input type="range" class="ctrlRange" id="rng_'+id+'" min="0" max="100" value="100">'+
        '<button class="ctrlBtn" id="stop_'+id+'">⏸ Stop</button>'+
      '</div>';
    g.appendChild(d);
  });
}

function buildRipple(){
  const svg = $('#rippleSvg');
  const pos = {
    furnace:[70,55], mixer:[230,55], convA:[390,55], press:[550,55],
    cooler:[390,160], convB:[550,160], packer:[710,160],
  };
  const W=130,H=52;
  // edges
  const mk = (x1,y1,x2,y2,cls,id,dashed) => {
    const d='M'+x1+' '+y1+' C '+((x1+x2)/2)+' '+y1+', '+((x1+x2)/2)+' '+y2+', '+x2+' '+y2;
    const depth = document.createElementNS('http://www.w3.org/2000/svg','path');
    depth.setAttribute('d',d); depth.setAttribute('class','edge-depth'); depth.setAttribute('transform','translate(0 5)');
    svg.appendChild(depth);
    const p = document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d',d);
    p.setAttribute('class', cls);
    p.setAttribute('marker-end','url(#arr)');
    svg.appendChild(p);
    elEdges[id]=p;
  };
  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML = '<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#2b3b4c"/></marker>'
    + '<linearGradient id="nodeGrad" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#1d2b3a"/>'
    + '<stop offset="0.55" stop-color="#16202b"/>'
    + '<stop offset="1" stop-color="#0d151d"/>'
    + '</linearGradient>'
    + '<linearGradient id="nodeTopGrad" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#31495d"/>'
    + '<stop offset="1" stop-color="#1a2937"/>'
    + '</linearGradient>';
  svg.appendChild(defs);

  const chain = [['furnace','mixer'],['mixer','convA'],['convA','press'],['press','cooler'],['cooler','convB'],['convB','packer']];
  chain.forEach((e,i)=>{
    const [a,b] = e;
    const [ax,ay] = pos[a], [bx,by] = pos[b];
    const x1 = ax + (bx>ax? W : -W), x2 = bx - (bx>ax? 6 : -6);
    if (ay===by) mk(x1, ay+H/2, x2, by+H/2, 'edge', 'e'+i);
    else mk(ax+W/2, ay+H+2, bx+W/2, by-4, 'edge', 'e'+i);
  });
  // power node
  const pw = document.createElementNS('http://www.w3.org/2000/svg','g');
  pw.setAttribute('class','node'); pw.id='node_power';
  pw.innerHTML = '<path class="node-top" d="M20 150 L28 158 L138 158 L130 150 Z"/>'+ 
    '<path class="node-side" d="M130 150 L138 158 L138 206 L130 198 Z"/>'+ 
    '<path class="node-bottom" d="M20 198 L130 198 L138 206 L28 206 Z"/>'+ 
    '<rect x="20" y="150" width="110" height="48" rx="8"/><text x="34" y="171" style="fill:#dce7f2;font-size:12px">🔌 Power</text><text x="34" y="188" class="val" id="pv">62%</text>';
  svg.appendChild(pw);
  mk(75,150, 250,110, 'power-edge','pe1', true);
  mk(130,174, 470,186, 'power-edge','pe2', true);

  // nodes
  FLOW.forEach(id=>{
    const [x,y] = pos[id];
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class','node'); g.id='node_'+id;
    const m = M[id];
    g.innerHTML = '<path class="node-top" d="M'+x+' '+y+' L'+(x+8)+' '+(y+8)+' L'+(x+W+8)+' '+(y+8)+' L'+(x+W)+' '+y+' Z"/>'+
      '<path class="node-side" d="M'+(x+W)+' '+y+' L'+(x+W+8)+' '+(y+8)+' L'+(x+W+8)+' '+(y+H+8)+' L'+(x+W)+' '+(y+H)+' Z"/>'+
      '<path class="node-bottom" d="M'+x+' '+(y+H)+' L'+(x+W)+' '+(y+H)+' L'+(x+W+8)+' '+(y+H+8)+' L'+(x+8)+' '+(y+H+8)+' Z"/>'+
      '<rect x="'+x+'" y="'+y+'" width="'+W+'" height="'+H+'" rx="8"/>'+
      '<text x="'+(x+10)+'" y="'+(y+19)+'">'+m.icon+' '+m.name+'</text>'+
      '<text x="'+(x+10)+'" y="'+(y+36)+'" class="val" id="rv_'+id+'">—</text>'+
      '<text x="'+(x+W-8)+'" y="'+(y+19)+'" text-anchor="end" class="st" id="st_'+id+'"></text>';
    svg.appendChild(g);
    elNodes[id]=g;
  });
}

function sparkline(hist, color){
  const values=hist.filter(Number.isFinite);
  if (values.length < 2) return '';
  const w=180, h=26, max=Math.max(...values, 1), min=Math.min(...values, 0);
  const range = (max-min)||1;
  const pts = values.map((v,i)=> (i/(values.length-1)*w).toFixed(1)+','+ (h-2 - (v-min)/range*(h-6)).toFixed(1)).join(' ');
  return '<svg width="'+w+'" height="'+h+'"><polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="1.6" opacity=".8"/></svg>';
}

function renderImpactAnalysis(){
  const active=[];
  if(window.pgInjectedFault){
    const f=window.pgInjectedFault, idx=FLOW.indexOf(f.id), m=M[f.id];
    if(f.scope==='line'||f.severity==='emergency'){
      active.push({source:'manual-line',title:'Emergency fault — production line stopped',problem:'Emergency simulated fault: whole production line stopped',
        detail:'The selected emergency scenario has stopped every production asset. Throughput is zero and financial shortfall accrues against the planned production rate until the operator clears the fault.',
        action:'Keep the line stopped, investigate the selected fault and restore production only after the fault is rectified and all assets are confirmed safe.',
        downstream:FLOW.slice(),upstream:[]});
    } else if(m){
      const critical=f.severity==='critical';
      const isStop=critical;
      active.push({source:f.id,title:m.name+(isStop?' unavailable due to critical fault':' operating below rated speed'),
        problem:isStop?'Critical simulated fault — machine unavailable':'Warning simulated fault — machine output reduced',
        detail:isStop?m.name+' is stopped by the selected critical scenario. Its zero output can accumulate upstream WIP and starve every downstream stage.':m.name+' is running at reduced capacity for the selected warning scenario. Output and financial exposure reflect the derated machine.',
        action:isStop?'Inspect the fault, safety interlocks and affected work area. Rectify the cause before restarting the machine.':'Inspect the machine condition, confirm stable readings and restore normal speed only after the warning is rectified.',
        downstream:FLOW.slice(idx+1),upstream:FLOW.slice(0,idx)});
    }
  }
  if(faults.jam) active.push({source:'convA',title:'Body Transfer Conveyor jam',problem:'Mechanical transfer jam / conveyor obstruction',detail:'The transfer conveyor is operating at approximately 35% effective throughput. Vehicle bodies cannot move reliably from the body shop into paint preparation.',action:'Stop or reduce upstream feed, inspect the conveyor drive and obstruction sensors, clear the jam under lockout procedures, then restart at reduced speed.',downstream:['press','cooler','convB','packer'],upstream:['furnace','mixer']});
  if(faults.cooler) active.push({source:'cooler',title:'Paint Cooling Tunnel overheating',problem:'Cooling tunnel temperature rising above its normal operating baseline',detail:'The cooling tunnel is losing thermal control. Its effective processing rate is reduced, creating a constraint before final assembly and risking paint-finish quality.',action:'Inspect cooling fans, airflow, filters and heat-exchanger performance. Reduce incoming vehicle-body feed if temperature continues to rise.',downstream:['convB','packer'],upstream:['press']});
  FLOW.forEach(id=>{
    const m=M[id];
    if(m.showTemp && m.temp>=m.tempWarn && !active.some(a=>a.source===id)){
      const idx=FLOW.indexOf(id), critical=m.temp>=m.tempCritical;
      active.push({source:id,title:m.name+' thermal excursion',problem:critical?'Critical thermal excursion at '+m.name:'Temperature warning at '+m.name,
        detail:m.name+' reads '+m.temp.toFixed(1)+'°C. Its configured warning and critical thresholds are '+m.tempWarn+'°C and '+m.tempCritical+'°C. Modeled effective capacity is '+Math.round(m.eff*100)+'% of its current rated capacity.',
        action:'Check sensor validity, cooling/lubrication and equipment loading. Follow the OEM operating procedure; do not change process temperatures outside approved limits.',
        downstream:FLOW.slice(idx+1),upstream:FLOW.slice(0,idx)});
    }
  });
  if(powerFaultActive) active.push({source:'power',title:'Plant electrical supply dip',problem:'Reduced plant electrical supply / power quality event',detail:'The simulated power event applies a 20% throughput derating across the production line. Multiple stations may slow together; this is a shared utility issue rather than an isolated machine fault.',action:'Check incoming supply and distribution panels, verify backup power readiness, and prioritize safe controlled operation.',downstream:FLOW.slice(),upstream:[]});
  const lineFaultActive=window.pgInjectedFault?.scope==='line';
  FLOW.forEach(id=>{if(!lineFaultActive&&M[id].stopped && !active.some(a=>a.source===id)) active.push({source:id,title:M[id].name+' stopped by administrator',problem:'Machine unavailable — commanded stop',detail:M[id].name+' has zero commanded speed. Upstream WIP can accumulate while downstream stages become starved.',action:'Confirm the reason for the stop, check the work area and safety interlocks, then restart only when safe.',downstream:FLOW.slice(FLOW.indexOf(id)+1),upstream:FLOW.slice(0,FLOW.indexOf(id))});});
  const state=$('#impactState'), problem=$('#impactProblem'), detail=$('#impactDetail'), assets=$('#impactAssets'), action=$('#impactAction');
  if(!state||!problem||!detail||!assets||!action)return;
  if(!active.length){state.textContent='NO ACTIVE FAULTS';state.className='impact-state healthy';problem.textContent='All production assets are operating within their configured demonstration limits.';detail.textContent='PulseGrid continuously evaluates temperature deviation, line speed, queue accumulation and machine availability.';assets.innerHTML='<span class="impact-none">No downstream impact detected.</span>';action.textContent='Continue monitoring. Review alerts if a machine deviates from its baseline.';return;}
  const a=active[0];state.textContent=active.length>1?'MULTIPLE ACTIVE EVENTS':'FAULT DETECTED';state.className='impact-state critical';
  problem.textContent=a.problem;detail.textContent=a.detail;
  const downstream=[...new Set(active.flatMap(x=>x.downstream))];
  assets.innerHTML=downstream.length?downstream.map(id=>'<span class="impact-asset '+(statusOf(id)==='crit'?'critical':'affected')+'"><b>'+M[id].name+'</b><small>'+ (statusOf(id)==='crit'?'Critical / constrained':'Downstream exposure') +'</small></span>').join(''):'<span class="impact-none">No downstream production stage.</span>';
  action.textContent=active.map(x=>x.action).join(' ');
  if(active.length>1)detail.textContent+=' Additional active events: '+active.slice(1).map(x=>x.title).join('; ')+'.';
}

function impactedMachineIds(){
  const ids=new Set();
  if(faults.jam) FLOW.slice(FLOW.indexOf('convA')+1).forEach(id=>ids.add(id));
  if(faults.cooler) FLOW.slice(FLOW.indexOf('cooler')+1).forEach(id=>ids.add(id));
  FLOW.forEach(id=>{if(M[id].showTemp && M[id].temp>=M[id].tempWarn) FLOW.slice(FLOW.indexOf(id)+1).forEach(next=>ids.add(next));});
  if(powerFaultActive) FLOW.forEach(id=>ids.add(id));
  FLOW.forEach(id=>{if(M[id].stopped) FLOW.slice(FLOW.indexOf(id)+1).forEach(next=>ids.add(next));});
  return ids;
}

function render(){
  const impacted=impactedMachineIds();
  // clock
  const mm = String(Math.floor(tick/60)).padStart(2,'0'), ss = String(tick%60).padStart(2,'0');
  $('#clock').textContent = 'Shift '+mm+':'+ss;

  // cards
  FLOW.forEach(id=>{
    const m = M[id], st = statusOf(id);
    const card = $('#card_'+id);
    card.className = 'card ' + (st==='ok'?'':st);
    const b = $('#badge_'+id); b.className='badge '+st; b.textContent = m.stopped ? 'STOPPED' : BADGE[st];
    const sb = $('#stop_'+id);
    if (sb && !m.ctlPending) sb.textContent = m.speed > 0 ? '⏸ Stop' : '▶ Start';
    $('#rate_'+id).textContent = Math.round(m.rate)+' vehicles/hr';
    const br = $('#barRate_'+id); br.style.width = (m.rate/m.base*100)+'%';
    br.style.background = st==='ok'?'var(--cyan)': st==='warn'?'var(--yellow)':'var(--red)';
    if (m.showTemp){
      $('#temp_'+id).textContent = Math.round(m.temp)+'°C ('+(m.dev>=0?'+':'')+m.dev.toFixed(1)+')';
      const bt = $('#barTemp_'+id);
      bt.style.width = clamp((m.temp - m.tRange[0])/(m.tRange[1]-m.tRange[0])*100, 3, 100)+'%';
      bt.style.background = st==='crit'?'var(--red)': st==='warn'?'var(--yellow)':'var(--orange)';
    }
    $('#spark_'+id).innerHTML = sparkline(m.hist, st==='ok'?'#38d6e0': st==='warn'?'#f5b942':'#ff5d5d');
    // node
    const node = elNodes[id];
    node.setAttribute('class','node ' + (st==='ok'?'':st) + (m.stopped?' stopped':'') + (impacted.has(id)?' affected':''));
    $('#rv_'+id).textContent = Math.round(m.rate)+' vehicles/hr';
    $('#st_'+id).textContent = st==='ok'?'':(m.stopped ? 'STOPPED' : BADGE[st]);
    $('#st_'+id).setAttribute('fill', st==='warn'?'#f5b942':'#ff5d5d');
  });
  renderFactoryDetails();
  const flowState=$('#factoryFlowState');
  if(flowState){
    const lineStopped=FLOW.every(id=>M[id].stopped);
    flowState.textContent=lineStopped?'LINE STOPPED · no material movement':'LIVE SIMULATION · machine colors follow current status';
  }
  $('#pv').textContent = Math.round(powerLoad)+'%';
  elEdges.pe1.setAttribute('class','power-edge' + (powerFaultActive?' hot':''));
  elEdges.pe2.setAttribute('class','power-edge' + (powerFaultActive?' hot':''));
  // hot edges: from any non-ok machine to its successor
  for (let i=0;i<JUNCTIONS;i++){
    const st = statusOf(FLOW[i]);
    const affected = (st!=='ok' && (wip[i] > 15 || st==='crit')) || impacted.has(FLOW[i+1]);
    elEdges['e'+i].setAttribute('class','edge' + (affected?' hot':''));
  }

  // KPIs
  const out = M.packer.rate;
  $('#vOut').textContent = Math.round(out);
  const avgEff = FLOW.reduce((s,id)=>s+M[id].eff,0)/FLOW.length;
  $('#vEff').textContent = Math.round(avgEff*100)+'%';
  $('#kpiEff').className = 'kpi ' + (avgEff>0.9?'ok': avgEff>0.75?'warn':'crit');
  const totWip = wip.reduce((a,b)=>a+b,0);
  $('#vWip').textContent = Math.round(totWip);
  $('#kpiWip').className = 'kpi ' + (totWip<80?'ok': totWip<180?'warn':'crit');
  const nAl = alerts.filter(a=>a.level!=='info').length;
  $('#vAl').textContent = nAl;
  $('#kpiAl').className = 'kpi ' + (nAl===0?'ok': nAl<3?'warn':'crit');
  $('#kpiOut').className = 'kpi ' + (out > 90 ? 'ok' : out > 65 ? 'warn' : 'crit');

  // alerts
  const list = $('#alertsList');
  if (!alerts.length){ list.innerHTML = '<div class="empty">No anomalies detected. Line is healthy.</div>'; }
  else {
    list.innerHTML = alerts.map(a=>{
      const t = 'Shift ' + String(Math.floor(a.tick/60)).padStart(2,'0') + ':' + String(a.tick%60).padStart(2,'0');
      return '<div class="alert '+a.level+'"><div class="t">'+t+'</div><b>'+a.title+'</b><br>'+a.msg+
        (a.fix? '<div class="fix">💡 '+a.fix+'</div>':'')+'</div>';
    }).join('');
  }

  // Fault diagnosis and downstream ripple explanation
  renderImpactAnalysis();
  updateFinancials(false);
  // what-if projection
  updateProjection();
  renderFactoryDetails();
}

/* ============ 5. CONTROLS ============ */
$('#pauseBtn').onclick = ()=>{
  paused = !paused;
  $('#pauseBtn').textContent = paused ? '▶ Resume' : '⏸ Pause';
  $('#liveDot').className = 'dot' + (paused?' paused':'');
  $('#liveTxt').textContent = paused ? 'PAUSED' : 'SIMULATING';
};
const voiceBtn = $('#voiceBtn');
voiceBtn.textContent = voiceOn ? '🔊 Voice' : '🔇 Muted';
voiceBtn.onclick = ()=>{
  voiceOn = !voiceOn;
  localStorage.setItem('pg_voice', voiceOn ? 'on' : 'off');
  voiceBtn.textContent = voiceOn ? '🔊 Voice' : '🔇 Muted';
  if (!voiceOn && 'speechSynthesis' in window) speechSynthesis.cancel();
  if (voiceOn) speak('Voice announcements enabled.');
};
$('#btnCooler').onclick = ()=>{ faults.cooler = !faults.cooler; flash($('#btnCooler'), faults.cooler); renderImpactAnalysis(); };
$('#btnJam').onclick = ()=>{ faults.jam = !faults.jam; if(!faults.jam) M.convA.speed=100; flash($('#btnJam'), faults.jam); renderImpactAnalysis(); };
$('#btnPower').onclick = ()=>{ powerFaultActive = true; flash($('#btnPower'), true); renderImpactAnalysis(); };
$('#btnFix').onclick = ()=>{
  faults.cooler = false; faults.jam = false; powerFaultActive = false;
  M.convA.speed = 100; convB_speed = 100; $('#whatIf').value = 100; $('#sliderVal').textContent='100%';
  FLOW.forEach(id => { M[id].speed = 100; M[id].stopped = false; });
  refreshCtrlUI();
  flash($('#btnFix'), false, true); renderImpactAnalysis();
};
$('#btnReset').onclick = ()=>{
  tick=0; alerts=[]; alertKeys={}; faults={cooler:false,jam:false}; powerFaultActive=false;
  FLOW.forEach(id=>{ M[id].speed=100; M[id].stopped=false; M[id].hist=[]; if(M[id].showTemp) M[id].temp = M[id].baseTemp; });
  wip = Array(JUNCTIONS).fill(0); wipHist = wipHist.map(()=>[]); wipAvg = Array(JUNCTIONS).fill(0);
  convB_speed=100; $('#whatIf').value=100; $('#sliderVal').textContent='100%';
  refreshCtrlUI();
};
$('#whatIf').oninput = e => { convB_speed = +e.target.value; $('#sliderVal').textContent = convB_speed+'%'; updateProjection(); };
$('#applyBtn').onclick = ()=>{ M.convB.speed = convB_speed; pushAlert('applied','info','What-if applied','Final Assembly Conveyor speed set to '+convB_speed+'% by operator from What-If Planner.',''); };
function flash(btn, on, ok){
  btn.style.borderColor = ok ? 'var(--green)' : on ? 'var(--red)' : 'var(--cyan)';
  btn.style.color = btn.style.borderColor;
  setTimeout(()=>{ btn.style.borderColor=''; btn.style.color=''; }, 900);
}


/* ============ MACHINE CONFIGURATION / UPGRADE WORKFLOW ============ */
let machineConfigLoaded = false;
function updateUpgradePreview(){
  const id=$('#configMachine')?.value, m=M[id]; if(!m) return;
  const proposed=Number($('#cfgCapacity').value);
  const currentLine=Math.min(...FLOW.map(key=>M[key].base));
  const nextLine=Math.min(...FLOW.map(key=>key===id && Number.isFinite(proposed)&&proposed>0?proposed:M[key].base));
  const delta=nextLine-currentLine;
  const label=delta>0.01?'potential line-capacity gain of '+delta.toFixed(1)+' vehicles/hr':delta<-0.01?'line capacity would decrease by '+Math.abs(delta).toFixed(1)+' vehicles/hr':'no change to the current line-capacity constraint';
  $('#upgradeImpactResult').textContent='Installed rating: '+m.base+' vehicles/hr. Proposed rating: '+(Number.isFinite(proposed)?proposed:'—')+' vehicles/hr. Current theoretical line ceiling: '+currentLine+' vehicles/hr; after this change: '+nextLine+' vehicles/hr ('+label+'). Actual output will also depend on efficiency, availability, queues and faults.';
}
function fillMachineConfigForm(id){
  const m=M[id]; if(!m || !$('#cfgName')) return;
  $('#configMachine').value=id;
  $('#cfgName').value=m.name; $('#cfgModel').value=m.model||'Standard';
  $('#cfgStage').value=m.stage||'Production';
  $('#cfgCapacity').value=m.base; $('#cfgSetpoint').value=m.tempSetpoint;
  $('#cfgWarn').value=m.tempWarn; $('#cfgCritical').value=m.tempCritical;
  $('#cfgReliability').value=m.reliability; $('#cfgHours').value=m.operatingHours||0;
  $('#upgradeCurrent').innerHTML='<b>'+m.name+'</b><span>'+m.model+' · '+m.base+' vehicles/hr · '+m.reliability+'% reliability</span>';
  updateUpgradePreview();
}
function renderMachineConfigOptions(){
  $('#configMachine').innerHTML=FLOW.map(id=>'<option value="'+id+'">'+M[id].name+'</option>').join('');
}
function applyMachineConfig(id,cfg){
  const m=M[id]; if(!m) return;
  m.name=cfg.name; m.stage=cfg.stage; m.base=Number(cfg.capacity);
  m.model=cfg.model; m.tempSetpoint=Number(cfg.tempSetpoint);
  m.tempWarn=Number(cfg.tempWarn); m.tempCritical=Number(cfg.tempCritical);
  m.baseTemp=m.tempSetpoint; m.reliability=Number(cfg.reliability);
  m.operatingHours=Number(cfg.operatingHours||0);
  m.tRange=[Math.min(m.tRange[0],m.tempSetpoint-15),Math.max(m.tRange[1],m.tempCritical+10)];
  m.temp=clamp(m.temp,m.tRange[0],m.tRange[1]);
  m.hist=[]; m.tempHist=[]; m.eff=1; m.rate=m.base*(m.speed/100);
  alertKeys={}; // Re-evaluate alarms against the new OEM-style thresholds.
  const card=$('#card_'+id);
  if(card){const n=card.querySelector('.name');if(n)n.textContent=m.name;}
  const factoryBtn=$('#factoryMachines [data-machine="'+id+'"] .factory-machine-name');
  if(factoryBtn)factoryBtn.textContent=m.name;
  if($('#configMachine')) renderMachineConfigOptions();
  fillMachineConfigForm(id);
  render();
}
async function loadMachineConfigurations(){
  if(!IS_HTTP || !pgToken) return;
  try{
    const r=await fetch('/api/machine-config',{headers:{Authorization:'Bearer '+pgToken}});
    const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.error||'Could not load machine configuration.');
    d.machines.forEach(cfg=>applyMachineConfig(cfg.id,cfg));
    machineConfigLoaded=true;
    $('#configSaveState').textContent='CONFIGURATION LOADED FROM PLANT DATABASE';
  }catch(e){$('#configSaveState').textContent='CONFIGURATION LOAD FAILED';toast(e.message,'crit');}
}
function bindMachineUpgradeUI(){
  if(!$('#configMachine')) return;
  renderMachineConfigOptions();
  $('#configMachine').addEventListener('change',e=>fillMachineConfigForm(e.target.value));
  ['cfgCapacity','cfgSetpoint','cfgWarn','cfgCritical','cfgReliability','cfgHours','cfgModel','cfgName','cfgStage'].forEach(id=>$('#'+id).addEventListener('input',updateUpgradePreview));
  $('#cfgReset').onclick=()=>fillMachineConfigForm($('#configMachine').value);
  $('#cfgSave').onclick=async()=>{
    const id=$('#configMachine').value;
    const cfg={machine:id,name:$('#cfgName').value.trim(),model:$('#cfgModel').value.trim(),stage:$('#cfgStage').value.trim(),
      capacity:Number($('#cfgCapacity').value),tempSetpoint:Number($('#cfgSetpoint').value),tempWarn:Number($('#cfgWarn').value),
      tempCritical:Number($('#cfgCritical').value),reliability:Number($('#cfgReliability').value),operatingHours:Number($('#cfgHours').value)};
    if(!cfg.name||!cfg.model||!cfg.stage||![cfg.capacity,cfg.tempSetpoint,cfg.tempWarn,cfg.tempCritical,cfg.reliability,cfg.operatingHours].every(Number.isFinite)||
      cfg.capacity<1||cfg.capacity>200||!(cfg.tempSetpoint<cfg.tempWarn&&cfg.tempWarn<cfg.tempCritical)||cfg.reliability<50||cfg.reliability>100||cfg.operatingHours<0){
      toast('Check the configuration. Temperature must follow normal < warning < critical.','crit');return;
    }
    if(!pgToken){toast('Administrator session missing. Sign in through the PulseGrid server before saving machine changes.','crit');return;}
    const btn=$('#cfgSave');btn.disabled=true;btn.textContent='Saving…';
    try{
      const r=await fetch('/api/machine-config',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pgToken},body:JSON.stringify(cfg)});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Configuration could not be saved.');
      applyMachineConfig(id,d.machine);
      $('#configSaveState').textContent='SAVED · '+new Date().toLocaleTimeString();
      $('#upgradeImpactResult').textContent='Updated baseline: '+d.machine.capacity+' vehicles/hr. Alerts, effective capacity and downstream queue projections now use the upgraded specification.';
      toast('Machine configuration saved. Simulation baseline updated.','ok');
    }catch(e){$('#configSaveState').textContent='SAVE FAILED · '+e.message;toast(e.message,'crit');}
    finally{btn.disabled=false;btn.textContent='Save machine configuration';}
  };
  fillMachineConfigForm(FLOW[0]);
}

/* ============ 6. AUTH (factory-scoped backend session) ============ */
const IS_HTTP = location.protocol.startsWith('http');
const pgToken = localStorage.getItem('pg_token');
let pgIsAdmin = false; // Single designated plant administrator.

if (IS_HTTP && !pgToken) {
  location.replace('login.html');
} else if (IS_HTTP) {
  const chip = $('#userChip'), out = $('#logoutBtn');
  chip.style.display = ''; out.style.display = '';
  const cachedFactory = (() => { try { return JSON.parse(localStorage.getItem('pg_factory') || '{}'); } catch (_) { return {}; } })();
  chip.textContent = 'ADMIN · ' + (cachedFactory.name || 'Apex Motors Plant');
  out.onclick = async () => {
    try { await fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + pgToken } }); } catch (_) {}
    localStorage.removeItem('pg_token'); localStorage.removeItem('pg_user'); localStorage.removeItem('pg_factory');
    location.replace('login.html');
  };
  fetch('/api/whoami', { headers: { Authorization: 'Bearer ' + pgToken } })
    .then(async r => { const d = await r.json(); if (!r.ok || !d.ok) throw new Error('Session expired'); return d; })
    .then(async d => {
      pgIsAdmin = true;
      bindMachineUpgradeUI();
      await loadMachineConfigurations();
      const factory=d.factory || {};
      localStorage.setItem('pg_user', 'Plant Administrator');
      localStorage.setItem('pg_factory', JSON.stringify(factory));
      chip.textContent = 'ADMIN · ' + (factory.name || 'Apex Motors Plant');
      const title=document.querySelector('header h1'); if(title) title.textContent='PulseGrid';
      const subtitle=document.querySelector('header .subtitle'); if(subtitle) subtitle.textContent='APEX MOTORS · VEHICLE ASSEMBLY OPERATIONS';
      enableAdminControls();
    })
    .catch(() => {
      localStorage.removeItem('pg_token'); localStorage.removeItem('pg_user'); localStorage.removeItem('pg_factory');
      location.replace('login.html');
    });
}

/* ---- authenticated factory-owner machine controls ---- */
function enableAdminControls(){
  if (!pgIsAdmin) return;
  FLOW.forEach(id => {
    const box = $('#ctrl_'+id); if (box) box.style.display = 'block';
    const rng = $('#rng_'+id), btn = $('#stop_'+id);
    if (!rng) return;
    rng.value = M[id].speed;
    $('#sp_'+id).textContent = M[id].speed + '%';
    btn.textContent = M[id].speed > 0 ? '⏸ Stop' : '▶ Start';
    rng.oninput = () => { $('#sp_'+id).textContent = rng.value + '%'; };
    rng.onchange = () => sendControl(id, 'speed', +rng.value);
    btn.onclick = () => sendControl(id, M[id].speed > 0 ? 'stop' : 'start', 0);
  });
  pushAlert('admin_on','info','🔓 Admin mode active','Machine controls unlocked — speed changes and stop/start are audited by the backend.','');
}
async function sendControl(id, action, value){
  const btn = $('#stop_'+id);
  if (M[id].ctlPending && M[id].ctlAction === action) return;   // ignore exact duplicate clicks
  M[id].ctlPending = true; M[id].ctlAction = action;
  // ---- OPTIMISTIC: apply instantly, confirm with backend in background ----
  const prevSpeed = M[id].speed;
  const target = action === 'stop' ? 0 : action === 'start' ? 100 : clamp(value, 0, 100);
  applyControlLocal(id, target);
  if (btn) btn.textContent = target > 0 ? '⏸ Stop' : '▶ Start';   // flip the button THIS frame
  if (M[id].stopped){
    pushAlert('ctl_'+id+'_'+target, 'crit', '⏸ ' + M[id].name + ' STOPPED by admin',
      'Output is now zero. Upstream machines will pile up units behind it.',
      'Press ▶ Start on ' + M[id].name + ' to resume production');
    speakOnce('ctl_'+id+'_'+target, 'Alert. ' + M[id].name + ' has been stopped by admin. Production at this stage is now zero.');
    toastOnce('ctl_'+id+'_'+target, '⏸ <b>' + M[id].name + ' STOPPED</b> by admin — output zero, upstream will pile up', 'crit');
  } else if (action === 'start'){
    pushAlert('ctl_'+id+'_'+target, 'info', '▶ ' + M[id].name + ' restarted by admin',
      'Line recovering.', '');
    speakOnce('ctl_'+id+'_'+target, M[id].name + ' restarted by admin.');
    toastOnce('ctl_'+id+'_'+target, '▶ <b>' + M[id].name + ' restarted</b> — line recovering', 'warn');
  } else {
    pushAlert('ctl_'+id+'_'+target, 'info', '🎛️ ' + M[id].name + ' → ' + target + '%',
      'Speed change applied (verified server-side, admin token required)', '');
  }
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pgToken },
      body: JSON.stringify({ machine: id, action: action, value: value }),
    });
    const d = await res.json();
    if (d.ok){
      M[id].speed = d.speed;
      M[id].stopped = (d.speed === 0);
      if (id === 'convB') convB_speed = d.speed;
      const rng = $('#rng_'+id);
      if (rng){ rng.value = d.speed; $('#sp_'+id).textContent = d.speed + '%'; }
      if (btn) btn.textContent = d.speed > 0 ? '⏸ Stop' : '▶ Start';
    } else {
      applyControlLocal(id, prevSpeed);          // backend refused -> revert instantly
      pushAlert('ctldeny_'+tick, 'crit', '🔒 Control denied', 'Backend rejected the command: ' + d.error, '');
    }
  } catch(e){
    applyControlLocal(id, prevSpeed);            // offline -> revert instantly
    pushAlert('ctlerr_'+tick, 'warn', 'Control unreachable', 'Could not reach backend control endpoint.', '');
  } finally {
    M[id].ctlPending = false; M[id].ctlAction = null;
  }
}
function applyControlLocal(id, speed){
  const m = M[id];
  m.speed = speed;
  m.stopped = (speed === 0);
  if (id === 'convB') convB_speed = speed;
  m.rate = clamp(m.base * (speed/100) * m.eff, 0, m.base * 1.05);   // instant rate feedback
  m.strainTicks = 0;
  render();                                      // 3D view + badges update this very frame
}
function refreshCtrlUI(){
  FLOW.forEach(id => {
    const rng = $('#rng_'+id); if (!rng) return;
    rng.value = M[id].speed; $('#sp_'+id).textContent = M[id].speed + '%';
    const btn = $('#stop_'+id);
    if (btn) btn.textContent = M[id].speed > 0 ? '⏸ Stop' : '▶ Start';
  });
}

/* ============ 6b. MOUSE PARALLAX (3D) ============ */
if (matchMedia('(pointer:fine)').matches){
  const grid = $('#machineGrid');
  if (grid){
    grid.addEventListener('mousemove', e => {
      const r = grid.getBoundingClientRect();
      grid.style.setProperty('--gx', ((e.clientX - r.left)/r.width - .5).toFixed(3));
      grid.style.setProperty('--gy', ((e.clientY - r.top)/r.height - .5).toFixed(3));
    });
    grid.addEventListener('mouseleave', () => {
      grid.style.setProperty('--gx', '0'); grid.style.setProperty('--gy', '0');
    });
  }
  const rw = document.querySelector('.ripple-wrap');
  if (rw){
    rw.addEventListener('mousemove', e => {
      const r = rw.getBoundingClientRect();
      rw.style.setProperty('--rx', ((e.clientY - r.top)/r.height - .5).toFixed(3));
    });
    rw.addEventListener('mouseleave', () => rw.style.setProperty('--rx', '0'));
  }
}

/* ============ 7. BOOT ============ */
buildGrid();
document.getElementById('machineGrid')?.addEventListener('click',e=>{const b=e.target.closest('[data-edit-machine]');if(!b)return;const id=b.dataset.editMachine;const nav=document.querySelector('[data-page=engineering]');nav?.click();if(document.getElementById('configMachine')){document.getElementById('configMachine').value=id;fillMachineConfigForm(id);}});
document.getElementById('financeMargin')?.addEventListener('input',()=>updateFinancials(false));
document.getElementById('financePlanRate')?.addEventListener('input',()=>updateFinancials(false));
document.getElementById('financeReset')?.addEventListener('click',resetFinancials);
buildRipple();
buildFactoryView();
render();
window.__PG = { M: M, FLOW: FLOW, tick: () => tick };   // debug/demo helper
setInterval(()=>{ if(!paused) doTick(); }, 1500);
