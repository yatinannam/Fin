import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

var DB_NAME = 'flatledger';
var sqliteConnection = new SQLiteConnection(CapacitorSQLite);
var db = null;

var SCHEMA_STATEMENTS = [
  'CREATE TABLE IF NOT EXISTS envelopes (id TEXT PRIMARY KEY, name TEXT NOT NULL, allocated REAL NOT NULL DEFAULT 0, spent REAL NOT NULL DEFAULT 0);',
  'CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT NOT NULL, amount REAL NOT NULL, title TEXT NOT NULL, sub TEXT, envelope_id TEXT, ts TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);'
];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function ensureSchema() {
  for (var i = 0; i < SCHEMA_STATEMENTS.length; i++) {
    await db.execute(SCHEMA_STATEMENTS[i]);
  }
}

async function getUnallocated() {
  var res = await db.query('SELECT value FROM meta WHERE key = ?', ['unallocated']);
  if (res.values && res.values.length > 0) {
    return parseFloat(res.values[0].value) || 0;
  }
  return 0;
}

// `inTransaction` (default false) signals that the caller has already opened
// an explicit db.beginTransaction()/commitTransaction() pair. When true, the
// inner db.run() calls are told not to auto-wrap themselves in their own
// transaction (transaction=false), so they participate in the caller's
// transaction instead of each auto-committing independently.
async function setUnallocated(amount, inTransaction) {
  var rounded = round2(amount);
  var existing = await db.query('SELECT key FROM meta WHERE key = ?', ['unallocated']);
  var selfCommit = !inTransaction;
  if (existing.values && existing.values.length > 0) {
    await db.run('UPDATE meta SET value = ? WHERE key = ?', [String(rounded), 'unallocated'], selfCommit);
  } else {
    await db.run('INSERT INTO meta (key, value) VALUES (?, ?)', ['unallocated', String(rounded)], selfCommit);
  }
}

async function addTx(type, amount, title, sub, envelopeId, inTransaction) {
  await db.run(
    'INSERT INTO transactions (id, type, amount, title, sub, envelope_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uid(), type, amount, title, sub || '', envelopeId || null, new Date().toISOString()],
    !inTransaction
  );
}

// Wraps `fn` (which must perform only db.run() writes, each passing
// transaction:false / inTransaction:true) in an explicit SQLite transaction.
// On any failure, rolls back and rethrows so callers see the original error.
async function withTransaction(fn) {
  await db.beginTransaction();
  try {
    var result = await fn();
    await db.commitTransaction();
    return result;
  } catch (e) {
    try {
      await db.rollbackTransaction();
    } catch (rollbackErr) {
      console.error('Rollback failed', rollbackErr);
    }
    throw e;
  }
}

export var Storage = {
  async init() {
    // Reconcile the JS-side connection map against the native plugin's own
    // connection registry first. If the WebView reloaded but the native
    // connection survived, this JS-side map is empty even though native
    // still holds it open; checkConnectionsConsistency() detects that and
    // has native close its stale connections so createConnection() below
    // won't be rejected as a duplicate.
    await sqliteConnection.checkConnectionsConsistency();
    var isConnResult = await sqliteConnection.isConnection(DB_NAME, false);
    if (isConnResult.result) {
      db = await sqliteConnection.retrieveConnection(DB_NAME, false);
    } else {
      db = await sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    }
    var isOpenResult = await db.isDBOpen();
    if (!isOpenResult.result) {
      await db.open();
    }
    await ensureSchema();
    var existing = await db.query('SELECT value FROM meta WHERE key = ?', ['unallocated']);
    if (!existing.values || existing.values.length === 0) {
      await setUnallocated(0);
    }
  },

  async getState() {
    var unallocated = await getUnallocated();
    var envRes = await db.query('SELECT id, name, allocated, spent FROM envelopes ORDER BY rowid ASC');
    var txRes = await db.query('SELECT id, type, amount, title, sub, ts FROM transactions ORDER BY ts DESC');
    return {
      unallocated: unallocated,
      categories: (envRes.values || []).map(function(c) {
        return { id: c.id, name: c.name, allocated: c.allocated, spent: c.spent };
      }),
      transactions: (txRes.values || []).map(function(t) {
        return { id: t.id, type: t.type, amount: t.amount, title: t.title, sub: t.sub || '', ts: t.ts };
      })
    };
  },

  async addIncome(amount, note) {
    var unallocated = await getUnallocated();
    var amt = round2(amount);
    await withTransaction(async function() {
      await setUnallocated(unallocated + amt, true);
      await addTx('income', amt, note || 'Money added', '', null, true);
    });
    return this.getState();
  },

  async addEnvelope(name, initial) {
    var unallocated = await getUnallocated();
    var initialAmt = round2(initial || 0);
    if (initialAmt > unallocated) {
      throw new Error('Not enough unallocated money');
    }
    var id = uid();
    await withTransaction(async function() {
      await db.run(
        'INSERT INTO envelopes (id, name, allocated, spent) VALUES (?, ?, ?, 0)',
        [id, name, initialAmt],
        false
      );
      await setUnallocated(unallocated - initialAmt, true);
      if (initialAmt > 0) {
        await addTx('allocate', initialAmt, 'Allocated to ' + name, '', id, true);
      }
    });
    return this.getState();
  },

  async logExpense(envelopeId, amount, note) {
    var envRes = await db.query('SELECT id, name, spent FROM envelopes WHERE id = ?', [envelopeId]);
    if (!envRes.values || envRes.values.length === 0) {
      throw new Error('Envelope not found');
    }
    var env = envRes.values[0];
    var amt = round2(amount);
    var newSpent = round2(env.spent + amt);
    await withTransaction(async function() {
      await db.run('UPDATE envelopes SET spent = ? WHERE id = ?', [newSpent, envelopeId], false);
      await addTx('expense', amt, note || ('Spent from ' + env.name), env.name, envelopeId, true);
    });
    return this.getState();
  },

  async allocateMore(envelopeId, amount) {
    var unallocated = await getUnallocated();
    var amt = round2(amount);
    if (amt > unallocated) {
      throw new Error('Not enough unallocated money');
    }
    var envRes = await db.query('SELECT id, name, allocated FROM envelopes WHERE id = ?', [envelopeId]);
    if (!envRes.values || envRes.values.length === 0) {
      throw new Error('Envelope not found');
    }
    var env = envRes.values[0];
    var newAllocated = round2(env.allocated + amt);
    await withTransaction(async function() {
      await db.run('UPDATE envelopes SET allocated = ? WHERE id = ?', [newAllocated, envelopeId], false);
      await setUnallocated(unallocated - amt, true);
      await addTx('allocate', amt, 'Allocated to ' + env.name, '', envelopeId, true);
    });
    return this.getState();
  },

  async deleteEnvelope(envelopeId) {
    var envRes = await db.query('SELECT id, name, allocated, spent FROM envelopes WHERE id = ?', [envelopeId]);
    if (!envRes.values || envRes.values.length === 0) {
      throw new Error('Envelope not found');
    }
    var env = envRes.values[0];
    var remaining = round2(env.allocated - env.spent);
    var unallocated = await getUnallocated();
    await withTransaction(async function() {
      await setUnallocated(unallocated + remaining, true);
      await db.run('DELETE FROM envelopes WHERE id = ?', [envelopeId], false);
      await addTx('move', remaining, 'Deleted ' + env.name, 'Balance returned', null, true);
    });
    return this.getState();
  },

  async reset() {
    await withTransaction(async function() {
      await db.run('DELETE FROM envelopes', [], false);
      await db.run('DELETE FROM transactions', [], false);
      await setUnallocated(0, true);
    });
    return this.getState();
  },

  async getAllTransactionsForExport() {
    var txRes = await db.query('SELECT ts, type, title, sub, amount FROM transactions ORDER BY ts DESC');
    return txRes.values || [];
  }
};
