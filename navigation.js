/* PulseGrid page navigation and configurable fault injection */
(() => {
  const $ = s => document.querySelector(s);
  const pages = {
    overview: $('#page-overview'),
    machines: $('#page-machines'),
    finance: $('#page-finance'),
    engineering: $('#page-engineering'),
    factory: $('#page-factory'),
    diagnostics: $('#page-diagnostics'),
    simulator: $('#page-simulator'),
    reports: $('#page-reports')
  };
  // Build a fixed, compact operations sidebar instead of a row of oversized tabs.
  const nav = $('.pg-nav');
  const shell = document.createElement('div');
  shell.className = 'pg-shell';
  const sidebarBrand = document.createElement('div');
  sidebarBrand.className = 'pg-sidebar-brand';
  sidebarBrand.innerHTML = '<div class="pg-brand-mark">P</div><div><b>PULSEGRID</b><small>PLANT OPERATIONS</small></div>';
  if (nav) {
    nav.classList.add('pg-sidebar');
    nav.prepend(sidebarBrand);
    const parent = nav.parentNode;
    parent.insertBefore(shell, nav);
    shell.appendChild(nav);
    Object.values(pages).forEach(node => { if (node) shell.appendChild(node); });
  }
  const move = (selector, page) => {
    const node = $(selector);
    if (node && pages[page]) pages[page].appendChild(node);
  };
  // Keep the existing components and IDs; only reorganize their presentation.
  move('.kpis', 'overview');
  move('#financialMonitor', 'overview');
  move('body > section:first-of-type', 'machines');
  move('#machineUpgradeSection', 'engineering');
  move('#financeDashboard', 'finance');
  move('.factory-section', 'factory');
  const allSections = [...document.querySelectorAll('body > section')];
  const dependency = allSections.find(s => s.querySelector('#rippleSvg'));
  if (dependency) pages.factory.appendChild(dependency);
  move('.impact-section', 'diagnostics');
  const split = $('.split');
  if (split) {
    const sections = [...split.querySelectorAll(':scope > section')];
    if (sections[0]) pages.diagnostics.appendChild(sections[0]);
    if (sections[1]) pages.simulator.appendChild(sections[1]);
    split.remove();
  }
  move('#faultSimulatorSection', 'simulator');
  move('#faultResponsePage', 'reports');
  const demo = [...document.querySelectorAll('body > section')].find(s => s.querySelector('#btnCooler'));
  if (demo) pages.simulator.appendChild(demo);
  const footer = $('footer');
  const overviewIntro = document.createElement('section');
  overviewIntro.className = 'overview-intro';
  overviewIntro.innerHTML = '<h2>Plant operations overview <span class="tag">APX-BLR-01</span></h2><p>Monitor the seven connected stages of the Apex Motors passenger-vehicle production line. Use the navigation to inspect assets, review the factory flow, investigate faults or run controlled scenarios.</p><div class="overview-shortcuts"><button data-goto="machines">View machine status</button><button data-goto="diagnostics">Open fault diagnostics</button><button data-goto="simulator">Run fault simulation</button></div>';
  pages.overview.appendChild(overviewIntro);

  function showPage(name) {
    Object.entries(pages).forEach(([key, node]) => {
      if (node) node.hidden = key !== name;
    });
    document.querySelectorAll('.pg-nav-item').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.page === name));
    if (footer) footer.hidden = false;
    window.scrollTo({top: 0, behavior: 'smooth'});
    window.dispatchEvent(new CustomEvent('pulsegrid:pagechange', {detail:{page:name}}));
    if(name==='factory'){
      requestAnimationFrame(()=>{
        if(typeof resizeFactoryCanvas==='function') resizeFactoryCanvas();
        if(typeof renderFactoryDetails==='function') renderFactoryDetails();
      });
    }
    if(name==='reports') window.PulseGridRandomFaults?.render();
  }
  document.querySelectorAll('.pg-nav-item').forEach(btn =>
    btn.addEventListener('click', () => showPage(btn.dataset.page)));
  document.querySelectorAll('[data-goto]').forEach(btn =>
    btn.addEventListener('click', () => showPage(btn.dataset.goto)));

  // Fault injection is intentionally a synthetic scenario, separate from physical controls.
  let activeScenario = null;
  const status = $('#faultScenarioStatus');
  const machineSelect = $('#simFaultMachine');
  const typeSelect = $('#simFaultType');
  const severitySelect = $('#simFaultSeverity');
  const scopeSelect = $('#simFaultScope');
  const labelFor = id => (window.PULSEGRID_MACHINE_LABELS || {})[id] || machineSelect?.selectedOptions[0]?.textContent || id;
  function restoreScenario(scenario) {
    if (!scenario || typeof M === 'undefined' || !M[scenario.id]) return;
    const machine=M[scenario.id];
    machine.speed=scenario.originalSpeed;
    machine.stopped=scenario.originalStopped;
    if (machine.showTemp && Number.isFinite(scenario.originalTemp)) machine.temp=scenario.originalTemp;
  }
  function applyScenario() {
    if (!activeScenario) return;
    const {id, type} = activeScenario;
    if (typeof M === 'undefined' || !M[id]) return;
    if (typeof renderImpactAnalysis === 'function') renderImpactAnalysis();
    if (typeof render === 'function') render();
    if (status) status.textContent = `${labelFor(id)} — ${type.toUpperCase()} scenario active until the operator clears or resolves it.`;
  }
  $('#runFaultScenario')?.addEventListener('click', () => {
    if(activeScenario) window.PulseGridRandomFaults?.resolveManual(activeScenario.id);
    restoreScenario(activeScenario);
    const id = machineSelect.value;
    const type = typeSelect.value;
    const severity = severitySelect.value;
    const scope = severity === 'emergency' ? 'line' : scopeSelect.value;
    activeScenario = {id, type, severity, scope};
    window.pgInjectedFault = activeScenario;
    window.PulseGridRandomFaults?.startManualFault(id,type,severity,scope);
    applyScenario();
  });
  $('#clearFaultScenario')?.addEventListener('click', () => {
    if(activeScenario) window.PulseGridRandomFaults?.resolveManual(activeScenario.id);
    restoreScenario(activeScenario);
    activeScenario = null;
    window.pgInjectedFault = null;
    if (status) status.textContent = 'Manual fault scenario cleared. Existing automatic simulation conditions may still generate alerts.';
    if (typeof renderImpactAnalysis === 'function') renderImpactAnalysis();
    if (typeof render === 'function') render();
  });
  // Legacy Resolve/Reset controls also clear the new scenario layer.
  ['btnFix','btnReset'].forEach(id => document.getElementById(id)?.addEventListener('click', () => {
    if(activeScenario) window.PulseGridRandomFaults?.resolveManual(activeScenario.id);
    if(activeScenario) restoreScenario(activeScenario);
    activeScenario=null;
    window.pgInjectedFault=null;
    if(status) status.textContent='Injected scenario cleared.';
  }));
  // Reapply the active scenario so normal simulation controls cannot clear it.
  setInterval(() => {
    if (activeScenario) applyScenario();
  }, 500);
  showPage('overview');
})();
