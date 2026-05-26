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

  // Encrypt sensitive values using OS credential storage (Windows DPAPI / macOS Keychain).
  // Falls back to plaintext when encryption is unavailable.
  encryptedSet(key, value) {
    const json = JSON.stringify(value);
    try {
      if (app.safeStorage.isEncryptionAvailable()) {
        const buf = app.safeStorage.encryptString(json);
        this.set(key, { _enc: buf.toString('base64') });
        return;
      }
    } catch {}
    this.set(key, value);
  }

  // Decrypts a value written by encryptedSet. Returns null on failure.
  // Handles migration: if the stored value is not in the encrypted format,
  // it is returned as-is so old sessions keep working until the next login.
  encryptedGet(key) {
    const raw = this.get(key);
    if (raw === undefined || raw === null) return null;
    if (raw && typeof raw === 'object' && typeof raw._enc === 'string') {
      try {
        const buf = Buffer.from(raw._enc, 'base64');
        return JSON.parse(app.safeStorage.decryptString(buf));
      } catch {
        return null;
      }
    }
    // Migration path: plaintext value written by an older version.
    return raw;
  }
}

module.exports = Store;
