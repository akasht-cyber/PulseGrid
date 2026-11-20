/* PulseGrid random incident training loop.
   One synthetic incident at a time; long randomized intervals model occasional
   plant events rather than continuous arcade-style faults. */
(() => {
  const FLOW_IDS = ['furnace','mixer','convA','press','cooler','convB','packer'];
  const INCIDENT_TYPES = [
    {key:'drive', label:'Drive motor overload trip', severity:'critical', mode:'stop', report:'Drive protection has issued a simulated overload trip. The station is unavailable and the line may accumulate work-in-progress upstream.', base:['Check the simulated drive status and overload flag.','Review the displayed load/current trend for an abnormal rise.','Confirm the cause is cleared before performing the restart check.']},
    {key:'sensor', label:'Process sensor drift', severity:'warning', mode:'slow', report:'A process feedback signal has drifted outside its configured tolerance. The controller has derated this station pending operator verification.', base:['Compare the live reading with the configured setpoint and recent trend.','Check the simulated sensor connection/status and look for an implausible jump.','After the reading is stable, acknowledge the warning and verify normal output.']},
    {key:'jam', label:'Material transfer obstruction', severity:'critical', mode:'stop', report:'A simulated transfer-path obstruction has stopped this station. Upstream work-in-progress may rise while downstream stations become starved.', base:['Inspect the transfer-path status and identify the blocked hand-off point.','Check the upstream/downstream queue indicators to locate where flow stopped.','Clear the simulated obstruction and complete the restart verification.']},
    {key:'thermal', label:'Thermal control deviation', severity:'warning', mode:'slow', report:'The process temperature has moved beyond its configured warning band. The station is running at reduced capacity while the thermal condition is checked.', base:['Compare live temperature with the machine setpoint and warning/critical thresholds.','Review cooling, ventilation or heater-control status as appropriate for this station.','Wait for the reading to return to its normal band before restoring full simulated speed.']}
  ];
  const MANUAL_TYPE_DETAILS = {
    stop:{label:'Operator-injected machine stoppage', report:'The selected machine has been stopped by the operator for a controlled fault-response scenario.', base:['Verify the machine stop command, safety interlocks and affected work area.','Review upstream WIP and downstream starvation before deciding whether to stop adjacent assets.','Rectify the simulated cause and complete the restart verification before restoring production.']},
    slow:{label:'Operator-injected reduced-speed fault', report:'The selected machine is operating at reduced capacity for a controlled fault-response scenario. Output and financial exposure reflect the selected severity.', base:['Compare commanded speed with actual speed and inspect drive/load feedback.','Review queue buildup and downstream starvation around the affected machine.','Confirm stable operation before restoring the normal speed command.']},
    overheat:{label:'Operator-injected thermal excursion', report:'The selected machine has been driven beyond its normal thermal operating band for a controlled fault-response scenario. Capacity is derated until the condition is rectified.', base:['Validate the displayed temperature against the configured warning and critical thresholds.','Inspect cooling, ventilation, lubrication and sensor plausibility using approved procedures.','Wait for the simulated reading to recover before restoring full production.']},
    jam:{label:'Operator-injected mechanical jam', report:'A simulated mechanical obstruction is affecting the selected machine. Material flow and downstream output reflect the selected severity.', base:['Stop or reduce upstream feed and identify the blocked transfer point.','Inspect the simulated drive, obstruction and transfer-ready indicators.','Clear the simulated obstruction under the required safety procedure before restarting.']}
  };
  const MACHINE_ADVICE = {
    furnace:{drive:'Stamping press: inspect the simulated main-drive and flywheel status, then verify press-ready/interlock indicators.',sensor:'Stamping press: compare the stroke/position feedback with the configured reference and check for a stable sensor signal.',jam:'Stamping press: check the blank-feed and transfer hand-off indicators for a sheet or part-feed obstruction.',thermal:'Stamping press: inspect motor/bearing temperature trend and cooling/ventilation status; do not treat this as a die-temperature recipe.'},
    mixer:{drive:'Welding cell: inspect robot-axis drive status and the affected axis alarm; verify the cell is clear before the simulated restart.',sensor:'Welding cell: verify robot position feedback and weld-cell sensing status against the configured reference.',jam:'Welding cell: inspect the body-in-position fixture and transfer interlock indicators for a blocked hand-off.',thermal:'Welding cell: review robot controller/cabinet cooling and axis motor temperature indicators.'},
    convA:{drive:'Body conveyor: inspect conveyor drive status, belt/roller feedback and the transfer-ready interlock.',sensor:'Body conveyor: verify photo-eye/position sensor state and check whether a body is being detected continuously.',jam:'Body conveyor: locate the blocked transfer zone using the WIP indicators and check the simulated roller/transfer status.',thermal:'Body conveyor: inspect the drive motor and gearbox temperature trend plus ventilation status.'},
    press:{drive:'Paint curing oven: inspect circulation-fan and conveyor-drive status; confirm the oven conveyor is ready before restart.',sensor:'Paint curing oven: compare zone-temperature feedback with its configured setpoint and review sensor plausibility.',jam:'Paint curing oven: inspect the oven conveyor entry/exit transfer indicators for a body-spacing or conveyor obstruction.',thermal:'Paint curing oven: identify which displayed zone is deviating, then review heater-control, circulation and exhaust status. Use the approved OEM recipe in real operations.'},
    cooler:{drive:'Cooling tunnel: inspect extraction-fan and conveyor-drive status, then verify the airflow/transfer indicators.',sensor:'Cooling tunnel: verify the temperature sensor location and compare its reading with the configured setpoint.',jam:'Cooling tunnel: inspect tunnel entry/exit transfer and roller status for a blocked vehicle body.',thermal:'Cooling tunnel: review fan/extraction status and airflow indication; confirm temperature recovery before restoring full speed.'},
    convB:{drive:'Final assembly conveyor: inspect the conveyor drive, zone occupancy and downstream hand-off interlocks.',sensor:'Final assembly conveyor: verify vehicle-presence and zone-position sensors; check for a stuck occupancy signal.',jam:'Final assembly conveyor: identify the occupied or blocked zone from WIP/occupancy indicators and check the next hand-off.',thermal:'Final assembly conveyor: inspect drive motor/gearbox temperature and cooling ventilation; this is an equipment condition, not vehicle-process temperature.'},
    packer:{drive:'End-of-line inspection: inspect the inspection-station conveyor/handling drive and confirm the dispatch lane is clear.',sensor:'End-of-line inspection: verify camera trigger, vehicle-presence sensor and inspection handshake status.',jam:'End-of-line inspection: inspect the inspection nest and dispatch transfer lane for a vehicle that has not cleared the station.',thermal:'End-of-line inspection: review vision-controller cabinet cooling and the temperature trend of the inspection equipment.'}
  };
  // One model tick = one simulated minute; ticks run every 1.5 seconds in demo mode.
  // Initial event after 120–240 simulated minutes; subsequent incidents 180–360 min apart.
  let nextEventTick = 120 + Math.floor(Math.random()*121);
  let active = [], history = [], sequence = 0;
  const $ = id => document.getElementById(id);
  const label = id => window.PULSEGRID_MACHINE_LABELS?.[id] || window.M?.[id]?.name || id;
  const shiftTime = t => `Shift ${String(Math.floor(t/60)%24).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;

  function notify(item) {
    let host=$('pgIncidentToasts');
    if(!host){host=document.createElement('div');host.id='pgIncidentToasts';host.className='pg-incident-toasts';document.body.appendChild(host);}
    const toast=document.createElement('button'); toast.type='button'; toast.className='pg-incident-toast '+item.severity;
    toast.innerHTML=`<strong>${item.severity==='warning'?'MAINTENANCE WARNING':item.severity==='emergency'?'EMERGENCY INCIDENT':'CRITICAL INCIDENT'}</strong><b>${item.machineName}</b><span>${item.typeLabel} · Open fault response report</span>`;
    toast.addEventListener('click',()=>{document.querySelector('[data-page="reports"]')?.click();toast.remove();});
    host.appendChild(toast);setTimeout(()=>toast.classList.add('visible'),20);setTimeout(()=>toast.remove(),15000);
  }
  function suggestionsFor(machineId,type){
    const machineSpecific=MACHINE_ADVICE[machineId]?.[type.key];
    return [machineSpecific,...type.base].filter(Boolean);
  }
  function beginRandomFault(){
    const machines=window.M;if(!machines)return;
    const candidates=FLOW_IDS.filter(id=>!active.some(a=>a.machineId===id));if(!candidates.length)return;
    const machineId=candidates[Math.floor(Math.random()*candidates.length)], type=INCIDENT_TYPES[Math.floor(Math.random()*INCIDENT_TYPES.length)], m=machines[machineId];
    const item={id:'INC-'+String(++sequence).padStart(4,'0'),machineId,machineName:m.name||label(machineId),typeLabel:type.label,key:type.key,severity:type.severity,mode:type.mode,report:type.report,suggestions:suggestionsFor(machineId,type),startedTick:window.tick||0,original:{speed:m.speed,stopped:m.stopped,temp:m.temp},status:'ACTIVE'};
    active.unshift(item);apply(item);render();notify(item);
    if(typeof window.pushAlert==='function')window.pushAlert('random_'+item.id,type.severity==='critical'?'crit':'warn',`${item.machineName}: ${type.label}`,type.report,item.suggestions.join(' '));
  }
  function apply(item){
    if(item.scope==='line'){
      FLOW_IDS.forEach(id=>{const machine=window.M?.[id];if(machine){machine.stopped=true;machine.speed=0;}});
      return;
    }
    const m=window.M?.[item.machineId];if(!m)return;
    if(item.mode==='stop'){m.stopped=true;m.speed=0;}
    else{m.stopped=false;m.speed=Math.min(item.original.speed??100,70);if(item.key==='thermal'&&m.showTemp)m.temp=Math.min(m.tRange?.[1]??999,Math.max(m.tempWarn+2,m.tempCritical-4));}
  }
  function applyToMachines(){active.forEach(apply);}
  function resolve(id){
    const index=active.findIndex(x=>x.id===id);if(index<0)return;
    const item=active[index],m=window.M?.[item.machineId];
    if(item.scope==='line'&&item.originalMachines){
      Object.entries(item.originalMachines).forEach(([machineId,original])=>{const machine=window.M?.[machineId];if(machine){machine.speed=original.speed;machine.stopped=original.stopped;if(Number.isFinite(original.temp))machine.temp=original.temp;}});
    } else if(m){m.speed=item.original.speed??100;m.stopped=item.original.stopped??false;if(Number.isFinite(item.original.temp))m.temp=item.original.temp;}
    item.status='RESOLVED';item.resolvedTick=window.tick||0;history.unshift(item);active.splice(index,1);
    // Schedule the next event relative to resolution, not the time the previous
    // fault began, preventing an immediate back-to-back incident after repair.
    nextEventTick=(window.tick||0)+180+Math.floor(Math.random()*181);
    render();if(typeof window.render==='function')window.render();if(typeof window.renderImpactAnalysis==='function')window.renderImpactAnalysis();
  }
  function startManualFault(machineId,key,severity,requestedScope='machine'){
    const m=window.M?.[machineId], detail=MANUAL_TYPE_DETAILS[key];
    if(!m||!detail)return null;
    const scope=severity==='emergency'||requestedScope==='line'?'line':'machine';
    const mode=severity==='warning'?'slow':'stop';
    const adviceKey=key==='overheat'?'thermal':key;
    const originalMachines=scope==='line'?Object.fromEntries(FLOW_IDS.map(id=>{const machine=window.M[id];return [id,{speed:machine.speed,stopped:machine.stopped,temp:machine.temp}];})):null;
    const scopeLabel=scope==='line'?'Production line impact':'Local machine impact';
    const report=scope==='line'?detail.report+' This line-wide scenario stops every machine, sets production output to zero and increases financial exposure until rectified.':detail.report;
    const item={id:'MAN-'+String(++sequence).padStart(4,'0'),machineId,machineName:m.name||label(machineId),typeLabel:detail.label+' · '+scopeLabel,key,severity,mode,scope,report,suggestions:[MACHINE_ADVICE[machineId]?.[adviceKey],...detail.base].filter(Boolean),startedTick:window.tick||0,original:scope==='line'?null:{speed:m.speed,stopped:m.stopped,temp:m.temp},originalMachines,status:'ACTIVE',manual:true};
    active.unshift(item);apply(item);render();notify(item);
    if(typeof window.pushAlert==='function')window.pushAlert('manual_'+item.id,severity==='warning'?'warn':'crit',`${item.machineName}: ${detail.label}`,item.report,item.suggestions.join(' '));
    return item;
  }
  function resolveManual(machineId){
    const item=active.find(x=>x.manual&&x.machineId===machineId);
    if(item)resolve(item.id);
  }
  function render(){
    const activeHost=$('activeIncidentReports'),historyHost=$('incidentHistory');
    if(activeHost)activeHost.innerHTML=active.length?active.map(x=>`<article class="incident-card ${x.severity}"><div class="incident-card-top"><span class="incident-id">${x.id}</span><span class="incident-status">${x.severity.toUpperCase()}</span></div><h4>${x.machineName}</h4><b>${x.typeLabel}</b><p>${x.report}</p><div class="incident-meta">Detected ${shiftTime(x.startedTick)} · ${Math.max(0,(window.tick||0)-x.startedTick)} simulated minutes since detection</div><div class="incident-fix"><b>Fault-specific diagnosis &amp; rectification guidance</b><ol>${x.suggestions.map(s=>`<li>${s}</li>`).join('')}</ol><p><strong>Before restoring:</strong> confirm the simulated fault indicator has cleared and the machine is safe/ready. In a real plant, follow OEM procedures, permits and lockout/tagout requirements.</p></div><button type="button" class="incident-resolve" data-resolve="${x.id}">✓ Confirm rectification &amp; restore machine</button></article>`).join(''):'<p class="empty">No active incidents. The plant is in monitoring mode; the next training event is scheduled at a randomized interval.</p>';
    if(historyHost)historyHost.innerHTML=history.length?history.slice(0,12).map(x=>`<div class="incident-history-row"><b>${x.machineName}</b><span>${x.typeLabel}</span><small>${x.id} · Resolved ${shiftTime(x.resolvedTick)}</small><em>RESTORED</em></div>`).join(''):'<p class="empty">Resolved incidents will appear here.</p>';
    const count=$('activeIncidentCount'),nav=$('incidentNavCount'),banner=$('faultResponseBanner');
    if(count)count.textContent=active.length;if(nav){nav.textContent=active.length;nav.classList.toggle('has-incidents',active.length>0);}
    if(banner){banner.classList.toggle('has-active',active.length>0);banner.textContent=active.length?`${active.length} active incident requires operator attention. Review the machine-specific guidance and confirm rectification to restore normal operation.`:'All monitored machines are currently clear. Random training incidents are intentionally infrequent.';}
    activeHost?.querySelectorAll('[data-resolve]').forEach(btn=>btn.addEventListener('click',()=>resolve(btn.dataset.resolve)));
  }
  function onTick(){if(!active.length&&(window.tick||0)>=nextEventTick)beginRandomFault();}
  window.PulseGridRandomFaults={onTick,applyToMachines,render,resolve,startManualFault,resolveManual,getActive:()=>active};
  document.addEventListener('DOMContentLoaded',render);
  document.addEventListener('click',e=>{if(e.target.closest('[data-page="reports"]'))render();});
  setInterval(render,5000);
})();
