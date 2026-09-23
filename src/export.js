import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function csvEscape(value) {
  var s = String(value === null || value === undefined ? '' : value);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCsv(rows) {
  var lines = ['Date,Type,Title,Note,Amount'];
  rows.forEach(function(r) {
    lines.push([
      csvEscape(r.ts),
      csvEscape(r.type),
      csvEscape(r.title),
      csvEscape(r.sub),
      csvEscape(r.amount)
    ].join(','));
  });
  return lines.join('\n');
}

export var Export = {
  async exportCsv(rows) {
    var csv = buildCsv(rows);
    var fileName = 'flat-ledger-export-' + Date.now() + '.csv';
    var writeResult = await Filesystem.writeFile({
      path: fileName,
      data: csv,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    });
    await Share.share({
      title: 'Flat Ledger export',
      dialogTitle: 'Export transactions',
      files: [writeResult.uri]
    });
  }
};
