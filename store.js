const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Plain JSON-on-disk store. Sensitive values are wrapped by main.js before being passed in here
// (see ENCRYPTED_KEYS + safeStorage in main.js), so this layer only handles serialization.
class Store {
  constructor() {
    const dir = app.getPath('userData');
    this._file = path.join(dir, 'paltocraft-config.json');
    this._data = {};
    this._load();
  }

  _load() {
    if (!fs.existsSync(this._file)) return;
    try {
      const raw = fs.readFileSync(this._file, 'utf8');
      this._data = JSON.parse(raw);
    } catch (e) {
      console.warn('[store] config corrupted, starting fresh:', e.message);
      try {
        // Keep the broken file for forensics instead of silently overwriting.
        fs.renameSync(this._file, this._file + '.broken-' + Date.now());
      } catch {}
      this._data = {};
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this._file), { recursive: true });
      // Atomic-ish write: tmp + rename so a kill mid-write doesn't corrupt the live file.
      const tmp = this._file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2), 'utf8');
      fs.renameSync(tmp, this._file);
    } catch (e) {
      console.warn('[store] write failed:', e.message);
    }
  }

  get(key) {
    return this._data[key];
  }

  set(key, value) {
    this._data[key] = value;
    this._save();
  }

  delete(key) {
    delete this._data[key];
    this._save();
  }
}

module.exports = Store;
