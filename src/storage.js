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

async function setUnallocated(amount) {
  var rounded = round2(amount);
  var existing = await db.query('SELECT key FROM meta WHERE key = ?', ['unallocated']);
  if (existing.values && existing.values.length > 0) {
    await db.run('UPDATE meta SET value = ? WHERE key = ?', [String(rounded), 'unallocated']);
  } else {
    await db.run('INSERT INTO meta (key, value) VALUES (?, ?)', ['unallocated', String(rounded)]);
  }
}

async function addTx(type, amount, title, sub, envelopeId) {
  await db.run(
    'INSERT INTO transactions (id, type, amount, title, sub, envelope_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uid(), type, amount, title, sub || '', envelopeId || null, new Date().toISOString()]
  );
}

export var Storage = {
  async init() {
    var isConnResult = await sqliteConnection.isConnection(DB_NAME, false);
    if (isConnResult.result) {
      db = await sqliteConnection.retrieveConnection(DB_NAME, false);
    } else {
      db = await sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    }
    await db.open();
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
    await setUnallocated(unallocated + amt);
    await addTx('income', amt, note || 'Money added', '');
    return this.getState();
  },

  async addEnvelope(name, initial) {
    var unallocated = await getUnallocated();
    var initialAmt = round2(initial || 0);
    if (initialAmt > unallocated) {
      throw new Error('Not enough unallocated money');
    }
    var id = uid();
    await db.run(
      'INSERT INTO envelopes (id, name, allocated, spent) VALUES (?, ?, ?, 0)',
      [id, name, initialAmt]
    );
    await setUnallocated(unallocated - initialAmt);
    if (initialAmt > 0) {
      await addTx('allocate', initialAmt, 'Allocated to ' + name, '', id);
    }
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
    await db.run('UPDATE envelopes SET spent = ? WHERE id = ?', [newSpent, envelopeId]);
    await addTx('expense', amt, note || ('Spent from ' + env.name), env.name, envelopeId);
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
    await db.run('UPDATE envelopes SET allocated = ? WHERE id = ?', [newAllocated, envelopeId]);
    await setUnallocated(unallocated - amt);
    await addTx('allocate', amt, 'Allocated to ' + env.name, '', envelopeId);
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
    await setUnallocated(unallocated + remaining);
    await db.run('DELETE FROM envelopes WHERE id = ?', [envelopeId]);
    await addTx('move', remaining, 'Deleted ' + env.name, 'Balance returned');
    return this.getState();
  },

  async reset() {
    await db.run('DELETE FROM envelopes');
    await db.run('DELETE FROM transactions');
    await setUnallocated(0);
    return this.getState();
  },

  async getAllTransactionsForExport() {
    var txRes = await db.query('SELECT ts, type, title, sub, amount FROM transactions ORDER BY ts DESC');
    return txRes.values || [];
  }
};
