'use strict';
// Drop-in replacement for the deprecated 'request' package.
// Implements only the API surface used by minecraft-launcher-core:
//   request(url)                    → PassThrough stream with 'response' event (streaming download)
//   request(url, cb)                → GET with callback(err, response, body)
//   request.get(url, cb)            → same as above
//   request.defaults({timeout, …})  → scoped request with default options
//   request.post({url, json}, cb)   → POST with JSON body and callback (for legacy Mojang auth stubs)

const https = require('https');
const http  = require('http');
const { PassThrough } = require('stream');

// ── Core GET implementation ───────────────────────────────────────────────────

function getRequest(url, options, callback) {
  const timeout = (options && options.timeout) || 50000;
  const pt = callback ? null : new PassThrough();

  function follow(currentUrl) {
    const lib = String(currentUrl).startsWith('https') ? https : http;
    const req = lib.get(currentUrl, { timeout }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return follow(res.headers.location);
      }

      if (callback) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => callback(null,
          { statusCode: res.statusCode, statusMessage: res.statusMessage, headers: res.headers },
          Buffer.concat(chunks).toString('utf8')
        ));
        res.on('error', err => callback(err));
      } else {
        pt.emit('response', { statusCode: res.statusCode, headers: res.headers });
        res.pipe(pt);
        res.on('error', err => pt.destroy(err));
      }
    });

    req.on('error', err => {
      if (callback) callback(err);
      else if (pt) pt.destroy(err);
    });
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Request timed out');
      err.code = 'ESOCKETTIMEDOUT';
      if (callback) callback(err);
      else if (pt) pt.destroy(err);
    });
  }

  follow(url);
  return pt; // null when callback is provided, PassThrough stream otherwise
}

// ── POST implementation (only needed for legacy Mojang auth, never called) ────

function postRequest(options, callback) {
  const url = options.url || options.uri;
  const body = options.json ? JSON.stringify(options.json) : (options.body || '');
  const lib = String(url).startsWith('https') ? https : http;
  const timeout = options.timeout || 50000;
  const urlObj = new URL(url);

  const reqOpts = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + (urlObj.search || ''),
    method: 'POST',
    headers: {
      'Content-Type': options.json ? 'application/json' : 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    },
    timeout
  };

  const req = lib.request(reqOpts, (res) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed = raw;
      if (options.json) { try { parsed = JSON.parse(raw); } catch {} }
      callback(null, { statusCode: res.statusCode, statusMessage: res.statusMessage }, parsed);
    });
    res.on('error', err => callback(err));
  });

  req.on('error', err => callback(err));
  req.on('timeout', () => { req.destroy(); callback(new Error('Request timed out')); });
  req.write(body);
  req.end();
}

// ── Public API ────────────────────────────────────────────────────────────────

function requestFn(url, callback) {
  if (url && typeof url === 'object') {
    const opts = url;
    return getRequest(opts.url || opts.uri, opts, callback || undefined);
  }
  return getRequest(url, {}, callback || undefined);
}

requestFn.get = requestFn;

requestFn.post = function(options, callback) {
  return postRequest(options, callback);
};

requestFn.defaults = function(defaultOptions) {
  function scoped(url, callback) {
    if (url && typeof url === 'object') {
      const opts = Object.assign({}, defaultOptions, url);
      return getRequest(opts.url || opts.uri, opts, callback || undefined);
    }
    return getRequest(url, defaultOptions, callback || undefined);
  }
  scoped.get  = scoped;
  scoped.post = requestFn.post;
  scoped.defaults = requestFn.defaults;
  return scoped;
};

module.exports = requestFn;
