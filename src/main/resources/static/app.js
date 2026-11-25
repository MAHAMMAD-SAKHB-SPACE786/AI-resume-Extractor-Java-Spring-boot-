(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  var root = document.documentElement;

  /* =========================================================
     Theme (dark / light)
     ========================================================= */
  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#theme')) { return; }
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (err) { /* ignore */ }
    drawCharts();   // chart colors depend on the theme
  });

  /* =========================================================
     Upload box: choose a file or drag and drop
     ========================================================= */
  var MAX_BYTES = 5 * 1024 * 1024;
  var input = $('file');
  var drop = $('drop');
  var fileLabel = $('file-name');
  var clientError = $('client-error');
  var defaultText = 'PDF only \u00B7 max 5 MB \u00B7 processed in memory';

  function showError(message) {
    clientError.textContent = message;
    clientError.hidden = !message;
  }

  function resetFile(message) {
    input.value = '';
    fileLabel.textContent = defaultText;
    drop.classList.remove('has-file');
    showError(message || '');
  }

  function refreshFile() {
    showError('');
    var f = input.files && input.files[0];
    if (!f) { return resetFile(''); }
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      return resetFile('Please choose a PDF file.');
    }
    if (f.size > MAX_BYTES) {
      return resetFile('This file is larger than 5 MB. Please choose a smaller PDF.');
    }
    fileLabel.textContent = f.name + ' \u00B7 ' + Math.max(1, Math.round(f.size / 1024)) + ' KB';
    drop.classList.add('has-file');
  }

  if (input && drop) {
    input.addEventListener('change', refreshFile);
    ['dragenter', 'dragover'].forEach(function (name) {
      drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.remove('drag'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        refreshFile();
      }
    });
  }

  /* =========================================================
     Loading screen while the local AI works
     ========================================================= */
  var form = $('form');
  var loading = $('loading');
  var tip = $('loading-tip');
  var goBtn = $('go');
  var tips = [
    'Reading the text from your PDF in memory...',
    'Structuring your resume into sections...',
    'Asking the local AI model to find skills in your experience...',
    'Checking every role skill and looking for proof in your work...',
    'Searching the knowledge base for the best learning resources...',
    'Writing your personalized roadmap...'
  ];
  var tipTimer = null;

  function showLoading() {
    if (!loading) { return; }
    loading.hidden = false;
    if (goBtn) { goBtn.disabled = true; }
    var i = 0;
    tip.textContent = tips[0];
    clearInterval(tipTimer);
    tipTimer = setInterval(function () {
      i = (i + 1) % tips.length;
      tip.textContent = tips[i];
    }, 6000);
  }

  function hideLoading() {
    if (loading) { loading.hidden = true; }
    if (goBtn) { goBtn.disabled = false; }
    clearInterval(tipTimer);
  }

  if (form) { form.addEventListener('submit', showLoading); }
  window.addEventListener('pageshow', hideLoading);   // Back button safety

  /* =========================================================
     HTMX events: loading screen, errors, charts, scroll
     ========================================================= */
  var toastTimer = null;
  function toast(message) {
    var t = $('toast');
    if (!t) { return; }
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 7000);
  }

  document.addEventListener('htmx:beforeRequest', function (e) {
    if (e.detail.elt && e.detail.elt.id === 'form') { showLoading(); }
  });
  document.addEventListener('htmx:afterRequest', function (e) {
    if (e.detail.elt && e.detail.elt.id === 'form') { hideLoading(); }
  });
  document.addEventListener('htmx:responseError', function (e) {
    hideLoading();
    toast('Something went wrong (error ' + e.detail.xhr.status + '). Look at the terminal where the app is running.');
  });
  document.addEventListener('htmx:sendError', function () {
    hideLoading();
    toast('Could not reach the app. Is it still running?');
  });

  // New results arrived: draw charts, update progress and scroll to them.
  // HTMX can fire several events for one swap, so we ignore repeats within a moment.
  var lastResultsInit = 0;
  function onResultsSwapped(e) {
    if (!e.target || e.target.id !== 'results') { return; }
    var now = Date.now();
    if (now - lastResultsInit < 400) { return; }
    lastResultsInit = now;
    initResults();
    if ($('p-overview')) {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  document.addEventListener('htmx:load', onResultsSwapped);
  document.addEventListener('htmx:afterSettle', onResultsSwapped);

  /* =========================================================
     Charts (Chart.js, bundled locally)
     ========================================================= */
  function toRgba(color, alpha) {
    var m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) { return color; }
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function drawCharts() {
    var canvas = $('radar');
    if (!canvas || typeof Chart === 'undefined') { return; }
    var old = Chart.getChart(canvas);
    if (old) { old.destroy(); }

    var labels = (canvas.getAttribute('data-labels') || '').split('|');
    var values = (canvas.getAttribute('data-values') || '').split('|').map(Number);
    var primary = cssVar('--primary');

    new Chart(canvas, {
      type: 'radar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Coverage %',
          data: values,
          fill: true,
          backgroundColor: toRgba(primary, 0.2),
          borderColor: primary,
          pointBackgroundColor: primary,
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { stepSize: 25, color: cssVar('--muted'), backdropColor: 'transparent' },
            grid: { color: cssVar('--border') },
            angleLines: { color: cssVar('--border') },
            pointLabels: { color: cssVar('--text'), font: { size: 12 } }
          }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  /* =========================================================
     Result tabs, filters, progress and copy buttons
     (event delegation, so they keep working after HTMX swaps)
     ========================================================= */
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (tab) {
      document.querySelectorAll('.tab').forEach(function (t) {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.panel').forEach(function (p) { p.hidden = true; });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      var panel = $(tab.getAttribute('data-target'));
      if (panel) { panel.hidden = false; }
      if (tab.getAttribute('data-target') === 'p-overview') { drawCharts(); }
      return;
    }

    var fbtn = e.target.closest('.fbtn');
    if (fbtn) {
      document.querySelectorAll('.fbtn').forEach(function (b) { b.classList.remove('active'); });
      fbtn.classList.add('active');
      applyMatrixFilter(fbtn.getAttribute('data-filter'));
      return;
    }

    var copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) { copyFrom(copyBtn); }
  });

  function applyMatrixFilter(filter) {
    document.querySelectorAll('.skill-row').forEach(function (row) {
      var s = row.getAttribute('data-status');
      var show = filter === 'all' || (filter === 'listed' ? (s === 'listed' || s === 'ai') : s === filter);
      row.hidden = !show;
    });
    document.querySelectorAll('.cat').forEach(function (cat) {
      cat.hidden = !cat.querySelector('.skill-row:not([hidden])');
    });
  }

  function updateProgress() {
    var all = document.querySelectorAll('.step-check');
    var done = document.querySelectorAll('.step-check:checked').length;
    var bar = $('pbar');
    var text = $('ptext');
    if (bar) { bar.style.width = (all.length ? (done * 100 / all.length) : 0) + '%'; }
    if (text) { text.textContent = done + ' of ' + all.length + ' steps done'; }
  }

  document.addEventListener('change', function (e) {
    if (e.target.classList && e.target.classList.contains('step-check')) { updateProgress(); }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id !== 'skill-search') { return; }
    var q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#skill-chips .chip').forEach(function (chip) {
      chip.hidden = !!q && chip.textContent.toLowerCase().indexOf(q) === -1;
    });
  });

  function copyFrom(btn) {
    var el = document.querySelector(btn.getAttribute('data-copy'));
    if (!el) { return; }
    var text = el.classList.contains('chips')
      ? Array.prototype.map.call(el.querySelectorAll('.chip'), function (c) { return c.textContent; }).join(', ')
      : el.textContent;
    var original = btn.textContent;
    var copied = navigator.clipboard
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error('Clipboard not available'));
    copied.then(
      function () { btn.textContent = 'Copied \u2713'; },
      function () { btn.textContent = 'Copy failed'; }
    ).then(function () {
      setTimeout(function () { btn.textContent = original; }, 1500);
    });
  }

  /* =========================================================
     Start-up
     ========================================================= */
  function initResults() {
    drawCharts();
    updateProgress();
  }

  function start() {
    initResults();
    // Page rendered with results already (no HTMX): scroll to them
    var results = $('results');
    if (results && $('p-overview')) {
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();