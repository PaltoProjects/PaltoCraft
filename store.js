const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor() {
    const dir = app.getPath('userData');
    this._file = path.join(dir, 'paltocraft-config.json');
    this._data = {};
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this._file, 'utf8');
      this._data = JSON.parse(raw);
    } catch {}
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this._file), { recursive: true });
      fs.writeFileSync(this._file, JSON.stringify(this._data, null, 2), 'utf8');
    } catch {}
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
