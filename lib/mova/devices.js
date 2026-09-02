'use strict';

const { isPairableVacuumModel } = require('./constants');

function extractDeviceRecords(listV2Body) {
  if (!listV2Body || typeof listV2Body !== 'object') {
    return [];
  }
  const data = listV2Body.data;
  const records = (data && data.page && data.page.records)
    || (data && data.records)
    || (data && data.list)
    || listV2Body.records
    || [];
  return Array.isArray(records) ? records : [];
}

function toPairableVacuum(record) {
  if (!record || !isPairableVacuumModel(record.model)) {
    return null;
  }
  const displayName = (record.deviceInfo && record.deviceInfo.displayName) || record.name;
  return {
    did: String(record.did),
    name: record.customName || displayName || `MOVA ${record.model}`,
    model: record.model,
    mac: record.mac || '',
    online: Boolean(record.online),
    bindDomain: record.bindDomain || '',
    masterUid: record.masterUid || record.uid || '',
  };
}

function filterPairableVacuums(records) {
  if (!Array.isArray(records)) {
    return [];
  }
  return records.map(toPairableVacuum).filter(Boolean);
}

function vacuumsFromListV2(listV2Body) {
  return filterPairableVacuums(extractDeviceRecords(listV2Body));
}

function toHomeyStoreDevice(device, credentials) {
  const { username, password, region } = credentials;
  const session = credentials.session || {};
  return {
    name: device.name,
    data: {
      id: device.did,
    },
    store: {
      username,
      password: password || '',
      region,
      model: device.model,
      bindDomain: device.bindDomain,
      masterUid: device.masterUid,
      mac: device.mac,
      accessToken: session.accessToken || '',
      refreshToken: session.refreshToken || '',
      expiresAt: session.expiresAt || 0,
      uid: session.uid || '',
    },
  };
}

function toHomeyPairingDevices(listV2Body, credentials) {
  return vacuumsFromListV2(listV2Body).map((device) => toHomeyStoreDevice(device, credentials));
}

module.exports = {
  extractDeviceRecords,
  toPairableVacuum,
  filterPairableVacuums,
  vacuumsFromListV2,
  toHomeyStoreDevice,
  toHomeyPairingDevices,
};
