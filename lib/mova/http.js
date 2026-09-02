'use strict';

const https = require('https');
const { URL } = require('url');

function parseJsonSafe(text) {
  if (text === undefined || text === null || text === '') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const err = new Error(`Invalid JSON from MOVAhome: ${error.message}`);
    err.cause = error;
    err.body = text;
    throw err;
  }
}

async function fetchTransport({ url, method, headers, body }) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  return { status: res.status, text };
}

function httpsTransport({ url, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: method || 'GET',
      headers: headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function wrapFetch(fetchImpl) {
  return async ({ url, method, headers, body }) => {
    const res = await fetchImpl(url, { method, headers, body });
    const text = typeof res.text === 'function' ? await res.text() : '';
    const status = res.status !== undefined ? res.status : 0;
    return { status, text };
  };
}

function defaultTransport() {
  if (typeof fetch === 'function') {
    return fetchTransport;
  }
  return httpsTransport;
}

function createTransport(options = {}) {
  if (typeof options.http === 'function') {
    return options.http;
  }
  if (typeof options.fetch === 'function') {
    return wrapFetch(options.fetch);
  }
  return defaultTransport();
}

module.exports = {
  parseJsonSafe,
  fetchTransport,
  httpsTransport,
  wrapFetch,
  defaultTransport,
  createTransport,
};
