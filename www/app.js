(function() {
  var STORAGE_KEY = 'flat-ledger-data-v1';
  var state = null;

  function defaultState() {
    return {
      unallocated: 0,
      categories: [],
      transactions: []
    };
  }

  function normalizeState(data) {
    var cats = Array.isArray(data.categories) ? data.categories : [];
    return {
      unallocated: round2(typeof data.unallocated === 'number' ? data.unallocated : 0),
      categories: cats.map(function(c) {
        return {
          id: c.id,
          name: c.name,
          allocated: round2(typeof c.allocated === 'number' ? c.allocated : 0),
          spent: round2(typeof c.spent === 'number' ? c.spent : 0)
        };
      }),
      transactions: Array.isArray(data.transactions) ? data.transactions : []
    };
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) {
      console.warn('Could not read saved data', e);
    }
    return defaultState();
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save data', e);
    }
  }

  function init() {
    state = loadLocal();
    var loadingEl = document.getElementById('loadingScreen');
    if (loadingEl) loadingEl.classList.add('hidden');
    render();
  }

  function fmt(n) {
    n = Math.round(n * 100) / 100;
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function addTx(type, amount, title, sub) {
    state.transactions.unshift({
      id: uid(), type: type, amount: amount, title: title, sub: sub || '',
      ts: new Date().toISOString()
    });
  }

  function render() {
    var totalAllocated = 0, totalSpent = 0;
    state.categories.forEach(function(c) {
      totalAllocated += c.allocated;
      totalSpent += c.spent;
    });
    document.getElementById('unallocatedAmt').textContent = fmt(state.unallocated);
    document.getElementById('totalAllocated').textContent = '₹' + fmt(totalAllocated);
    document.getElementById('totalSpent').textContent = '₹' + fmt(totalSpent);
    document.getElementById('totalIn').textContent = '₹' + fmt(state.unallocated + totalAllocated - totalSpent);

    var list = document.getElementById('envelopeList');
    list.innerHTML = '';
    if (state.categories.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No envelopes yet. Create one for rent, wifi, groceries — whatever you need to track.';
      list.appendChild(empty);
    }
    state.categories.forEach(function(c) {
      var remaining = c.allocated - c.spent;
      var pct = c.allocated > 0 ? Math.min(100, (c.spent / c.allocated) * 100) : 0;
      var over = remaining < 0;
      var div = document.createElement('div');
      div.className = 'envelope';
      div.innerHTML =
        '<div class="envelope-top">' +
          '<div class="name">' + escapeHtml(c.name) + '</div>' +
          '<div class="remaining' + (over ? ' over' : '') + '">₹' + fmt(remaining) + '</div>' +
        '</div>' +
        '<div class="envelope-meta"><span>Spent ₹' + fmt(c.spent) + '</span><span>of ₹' + fmt(c.allocated) + '</span></div>' +
        '<div class="bar"><div class="bar-fill' + (over ? ' over' : '') + '" style="width:' + pct + '%"></div></div>';
      div.addEventListener('click', function() { openDetail(c.id); });
      list.appendChild(div);
    });

    var hist = document.getElementById('historyList');
    hist.innerHTML = '';
    if (state.transactions.length === 0) {
      var e2 = document.createElement('div');
      e2.className = 'empty-state';
      e2.textContent = 'Nothing logged yet.';
      hist.appendChild(e2);
    }
    state.transactions.slice(0, 30).forEach(function(t) {
      var row = document.createElement('div');
      row.className = 'tx';
      var d = new Date(t.ts);
      var dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      var amtClass = t.type === 'income' ? 'in' : (t.type === 'expense' ? 'out' : 'move');
      var sign = t.type === 'income' ? '+' : (t.type === 'expense' ? '−' : '');
      row.innerHTML =
        '<div class="tx-left"><div class="tx-title">' + escapeHtml(t.title) + '</div>' +
        '<div class="tx-sub">' + dateStr + (t.sub ? ' · ' + escapeHtml(t.sub) : '') + '</div></div>' +
        '<div class="tx-amt ' + amtClass + '">' + sign + '₹' + fmt(Math.abs(t.amount)) + '</div>';
      hist.appendChild(row);
    });

    populateExpenseSelect();
    saveLocal();
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function populateExpenseSelect() {
    var sel = document.getElementById('expenseEnvelope');
    var current = sel.value;
    sel.innerHTML = '';
    if (state.categories.length === 0) {
      var opt = document.createElement('option');
      opt.textContent = 'Create an envelope first';
      opt.disabled = true;
      sel.appendChild(opt);
      return;
    }
    state.categories.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }

  function showOverlay(id) { document.getElementById(id).classList.add('show'); }
  function hideOverlay(id) { document.getElementById(id).classList.remove('show'); }

  document.getElementById('openAddIncome').addEventListener('click', function() {
    document.getElementById('incomeAmount').value = '';
    document.getElementById('incomeNote').value = '';
    document.getElementById('incomeError').style.display = 'none';
    showOverlay('incomeOverlay');
  });
  document.getElementById('incomeCancel').addEventListener('click', function() { hideOverlay('incomeOverlay'); });
  document.getElementById('incomeConfirm').addEventListener('click', function() {
    var amt = parseFloat(document.getElementById('incomeAmount').value);
    if (!amt || amt <= 0) {
      document.getElementById('incomeError').style.display = 'block';
      return;
    }
    var note = document.getElementById('incomeNote').value.trim();
    state.unallocated = round2(state.unallocated + amt);
    addTx('income', amt, note || 'Money added', '');
    hideOverlay('incomeOverlay');
    render();
  });

  document.getElementById('openAddEnvelope').addEventListener('click', function() {
    document.getElementById('envelopeName').value = '';
    document.getElementById('envelopeInitial').value = '';
    document.getElementById('envelopeError').style.display = 'none';
    showOverlay('envelopeOverlay');
  });
  document.getElementById('envelopeCancel').addEventListener('click', function() { hideOverlay('envelopeOverlay'); });
  document.getElementById('envelopeConfirm').addEventListener('click', function() {
    var name = document.getElementById('envelopeName').value.trim();
    var initial = parseFloat(document.getElementById('envelopeInitial').value) || 0;
    if (!name || initial < 0 || initial > state.unallocated) {
      document.getElementById('envelopeError').style.display = 'block';
      return;
    }
    var cat = { id: uid(), name: name, allocated: round2(initial), spent: 0 };
    state.categories.push(cat);
    state.unallocated = round2(state.unallocated - initial);
    if (initial > 0) addTx('allocate', initial, 'Allocated to ' + name, '');
    hideOverlay('envelopeOverlay');
    render();
  });

  document.getElementById('openLogExpense').addEventListener('click', function() {
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseNote').value = '';
    document.getElementById('expenseError').style.display = 'none';
    populateExpenseSelect();
    showOverlay('expenseOverlay');
  });
  document.getElementById('expenseCancel').addEventListener('click', function() { hideOverlay('expenseOverlay'); });
  document.getElementById('expenseConfirm').addEventListener('click', function() {
    var catId = document.getElementById('expenseEnvelope').value;
    var amt = parseFloat(document.getElementById('expenseAmount').value);
    var cat = state.categories.filter(function(c) { return c.id === catId; })[0];
    if (!cat || !amt || amt <= 0) {
      document.getElementById('expenseError').style.display = 'block';
      return;
    }
    var note = document.getElementById('expenseNote').value.trim();
    cat.spent = round2(cat.spent + amt);
    addTx('expense', amt, note || ('Spent from ' + cat.name), cat.name);
    hideOverlay('expenseOverlay');
    render();
  });

  var activeDetailId = null;
  function openDetail(id) {
    activeDetailId = id;
    var cat = state.categories.filter(function(c) { return c.id === id; })[0];
    if (!cat) return;
    document.getElementById('detailTitle').textContent = cat.name;
    document.getElementById('detailAllocate').value = '';
    document.getElementById('detailError').style.display = 'none';
    showOverlay('detailOverlay');
  }
  document.getElementById('detailClose').addEventListener('click', function() { hideOverlay('detailOverlay'); });
  document.getElementById('detailAllocateConfirm').addEventListener('click', function() {
    var cat = state.categories.filter(function(c) { return c.id === activeDetailId; })[0];
    var amt = parseFloat(document.getElementById('detailAllocate').value);
    if (!cat || !amt || amt <= 0 || amt > state.unallocated) {
      document.getElementById('detailError').style.display = 'block';
      return;
    }
    cat.allocated = round2(cat.allocated + amt);
    state.unallocated = round2(state.unallocated - amt);
    addTx('allocate', amt, 'Allocated to ' + cat.name, '');
    hideOverlay('detailOverlay');
    render();
  });
  document.getElementById('detailDelete').addEventListener('click', function() {
    var cat = state.categories.filter(function(c) { return c.id === activeDetailId; })[0];
    if (!cat) return;
    if (!confirm('Delete "' + cat.name + '"? Its remaining balance goes back to unallocated.')) return;
    var remaining = round2(cat.allocated - cat.spent);
    state.unallocated = round2(state.unallocated + remaining);
    state.categories = state.categories.filter(function(c) { return c.id !== activeDetailId; });
    addTx('move', remaining, 'Deleted ' + cat.name, 'Balance returned');
    hideOverlay('detailOverlay');
    render();
  });

  document.getElementById('resetBtn').addEventListener('click', function() {
    if (!confirm('Clear all data and start over? This cannot be undone.')) return;
    state = defaultState();
    render();
  });

  document.querySelectorAll('.overlay').forEach(function(ov) {
    ov.addEventListener('click', function(e) {
      if (e.target === ov) ov.classList.remove('show');
    });
  });

  init();
})();
