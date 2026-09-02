'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const zlib = require('zlib');
const { MovaCloudClient } = require('../lib/mova/client');
const {
  PASSWORD_SALT,
  AUTH_ENDPOINT,
  DEVICE_LIST_ENDPOINT,
  MAP_DOWNLOAD_ENDPOINT,
  MIOT_PROPERTIES,
  MIOT_ACTIONS,
  CLEANING_MODE,
  SUCTION_LEVEL,
  WATER_LEVEL,
  CLEAN_GENIUS,
} = require('../lib/mova/constants');
const {
  HEADER_SIZE,
  FRAME_I,
  FRAME_P,
  decodeMapPayload,
  toViewModel,
  serializeMapView,
  objectNameFromValue,
  objectNamesFromMapFile,
  decodeSavedMapContainer,
} = require('../lib/mova/map');
const { toHomeyPairingDevices, vacuumsFromListV2 } = require('../lib/mova/devices');
const { mapDeviceStatusToHomey, mapOnoff, mapCleanGenius } = require('../lib/mova/mapping');

const USERNAME = 'user@example.com';
const PASSWORD = 'secret-pass';
const DID = '2045332002';

const LOGIN_OK = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  uid: 'OU338468',
};

const LIST_V2 = {
  code: 0,
  success: true,
  data: {
    page: {
      records: [
        {
          did: DID,
          model: 'mova.vacuum.v70',
          customName: 'Living Room V70',
          mac: 'aa:bb:cc:dd:ee:ff',
          online: true,
          masterUid: 'OU338468',
          bindDomain: '20000.iot.mova-tech.com:19922',
        },
        {
          did: 'mower-1',
          model: 'mova.mower.g2529d',
          customName: 'Lawn mower',
          online: true,
          bindDomain: '20000.iot.mova-tech.com:19922',
        },
        {
          did: 'dreame-1',
          model: 'dreame.vacuum.r2456',
          customName: 'Dreame X40',
          online: true,
        },
        {
          did: 'plug-1',
          model: 'mova.plug.p1',
          customName: 'Outlet',
          online: true,
        },
      ],
    },
  },
};

const STATUS_PROPS = [
  { siid: 3, piid: 1, code: 0, value: 76 },
  { siid: 3, piid: 2, code: 0, value: 1 },
  { siid: 2, piid: 2, code: 0, value: 0 },
  { siid: 4, piid: 1, code: 0, value: 102 },
  { siid: 2, piid: 1, code: 0, value: 5 },
  { siid: 4, piid: 2, code: 0, value: 14 },
  { siid: 4, piid: 3, code: 0, value: 22 },
  { siid: 4, piid: 4, code: 0, value: 1 },
  { siid: 4, piid: 5, code: 0, value: 2 },
  { siid: 4, piid: 23, code: 0, value: 1 },
  { siid: 4, piid: 50, code: 0, value: '{"SmartHost":1,"CleanRoute":2}' },
  { siid: 9, piid: 2, code: 0, value: 82 },
  { siid: 10, piid: 2, code: 0, value: 64 },
  { siid: 11, piid: 1, code: 0, value: 41 },
  { siid: 16, piid: 1, code: 0, value: 18 },
  { siid: 18, piid: 1, code: 0, value: 90 },
];

function mappedStatus(extra) {
  const status = extra.operationalStatus;
  return {
    mainBrush: null,
    sideBrush: null,
    filter: null,
    mopPad: null,
    sensor: null,
    consumableLow: false,
    suctionLevel: null,
    waterLevel: null,
    error: false,
    cleaningTime: null,
    cleanedArea: null,
    cleanGenius: null,
    ...extra,
    onoff: extra.onoff !== undefined
      ? extra.onoff
      : (status === 'docked' || status === 'charging' ? false : Boolean(status)),
  };
}

function createCloudMock(options = {}) {
  const requests = [];
  const http = async ({ url, method, headers, body }) => {
    requests.push({
      url,
      method: method || 'GET',
      headers: headers || {},
      body: body || '',
    });
    if (String(url).includes(AUTH_ENDPOINT)) {
      return { status: 200, text: JSON.stringify(LOGIN_OK) };
    }
    if (String(url).includes(DEVICE_LIST_ENDPOINT)) {
      return { status: 200, text: JSON.stringify(LIST_V2) };
    }
    if (String(url).includes(MAP_DOWNLOAD_ENDPOINT) || String(url).includes('getOss1dDownloadUrl')) {
      return { status: 200, text: JSON.stringify({ code: 0, data: { url: 'https://oss.example/map.bin' } }) };
    }
    if (String(url).includes('/device/sendCommand')) {
      const parsed = JSON.parse(body);
      const methodName = parsed && parsed.data && parsed.data.method;
      if (methodName === 'get_properties') {
        const params = (parsed.data && parsed.data.params) || [];
        if (params.some((prop) => prop.siid === 6)) {
          const mapData = typeof options.mapData === 'function' ? options.mapData() : options.mapData;
          return {
            status: 200,
            text: JSON.stringify({
              code: 0,
              data: {
                id: parsed.id,
                result: [
                  { siid: 6, piid: 1, code: 0, value: mapData || '' },
                  { siid: 6, piid: 3, code: 0, value: options.objectName || '' },
                  { siid: 6, piid: 8, code: 0, value: options.mapList || '[]' },
                ],
              },
            }),
          };
        }
        return {
          status: 200,
          text: JSON.stringify({ code: 0, data: { id: parsed.id, result: STATUS_PROPS } }),
        };
      }
      return {
        status: 200,
        text: JSON.stringify({ code: 0, data: { id: parsed.id, result: { code: 0 } } }),
      };
    }
    return { status: 404, text: JSON.stringify({ error: `unmocked ${url}` }) };
  };
  http.requests = requests;
  return http;
}

function createClient(http, region = 'eu') {
  return new MovaCloudClient({
    username: USERNAME,
    password: PASSWORD,
    region,
    http,
  });
}

function commandBodies(http) {
  return http.requests
    .filter((request) => String(request.url).includes('/device/sendCommand'))
    .map((request) => JSON.parse(request.body));
}

describe('MOVAhome login', () => {
  it('hashes the password with the MOVAhome salt and POSTs an OAuth password grant', async () => {
    const http = createCloudMock();
    const client = createClient(http, 'eu');
    const session = await client.login();

    assert.equal(session.accessToken, 'test-access-token');
    assert.equal(http.requests.length, 1);
    const request = http.requests[0];
    assert.equal(request.method, 'POST');
    assert.equal(
      request.url,
      `https://eu.iot.mova-tech.com:13267${AUTH_ENDPOINT}`,
    );
    assert.match(request.headers['Content-Type'], /application\/x-www-form-urlencoded/);
    assert.equal(request.headers.Authorization, 'Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=');

    const body = new URLSearchParams(request.body);
    assert.equal(body.get('grant_type'), 'password');
    assert.equal(body.get('username'), USERNAME);
    assert.equal(body.get('scope'), 'all');
    assert.equal(body.get('type'), 'account');

    const expectedHash = crypto.createHash('md5')
      .update(`${PASSWORD}${PASSWORD_SALT}`, 'utf8')
      .digest('hex');
    assert.equal(PASSWORD_SALT, 'RAylYC%fmSKp7%Tq');
    assert.equal(body.get('password'), expectedHash);
    assert.notEqual(body.get('password'), PASSWORD);
  });

  it('uses the selected region host', async () => {
    const http = createCloudMock();
    const client = createClient(http, 'us');
    await client.login();
    assert.equal(
      http.requests[0].url,
      `https://us.iot.mova-tech.com:13267${AUTH_ENDPOINT}`,
    );
  });
});

describe('MOVAhome session refresh', () => {
  it('refreshes an expired session with a refresh token', async () => {
    const http = createCloudMock();
    const client = new MovaCloudClient({
      username: USERNAME,
      region: 'eu',
      http,
    });
    client.setSession({
      accessToken: 'old-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() - 1000,
      uid: 'OU338468',
      region: 'eu',
    });
    await client.listDevices();
    const tokenReq = http.requests.find((request) => String(request.url).includes(AUTH_ENDPOINT));
    assert.ok(tokenReq);
    const body = new URLSearchParams(tokenReq.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'test-refresh-token');
  });

  it('asks to set a MOVAhome password when the session cannot be restored', async () => {
    const http = createCloudMock();
    const client = new MovaCloudClient({
      username: USERNAME,
      region: 'eu',
      http,
    });
    await assert.rejects(
      () => client.listDevices(),
      /Set a password in the official MOVAhome app/,
    );
  });
});

describe('listV2 pairing', () => {
  it('returns mova.vacuum.* as pairable and excludes non-vacuum models', async () => {
    const http = createCloudMock();
    const client = createClient(http);
    await client.login();
    const vacuums = await client.listDevices();

    assert.equal(vacuums.length, 1);
    assert.equal(vacuums[0].did, DID);
    assert.equal(vacuums[0].model, 'mova.vacuum.v70');
    assert.equal(vacuums[0].name, 'Living Room V70');
    assert.equal(vacuums[0].bindDomain, '20000.iot.mova-tech.com:19922');
    assert.ok(!vacuums.some((device) => device.model.startsWith('mova.mower')));
    assert.ok(!vacuums.some((device) => device.model.startsWith('dreame.')));
    assert.ok(!vacuums.some((device) => device.model.includes('plug')));

    const listRequest = http.requests.find((request) => String(request.url).includes(DEVICE_LIST_ENDPOINT));
    assert.ok(listRequest);
    assert.equal(listRequest.method, 'POST');
    assert.equal(listRequest.headers['Dreame-Auth'], 'test-access-token');

    const pairing = toHomeyPairingDevices(LIST_V2, {
      username: USERNAME,
      password: PASSWORD,
      region: 'eu',
    });
    assert.equal(pairing.length, 1);
    assert.equal(pairing[0].data.id, DID);
    assert.equal(pairing[0].store.model, 'mova.vacuum.v70');
    assert.equal(pairing[0].store.username, USERNAME);
    assert.equal(pairing[0].store.password, PASSWORD);
    assert.equal(pairing[0].store.authMethod, undefined);
    assert.deepEqual(vacuumsFromListV2(LIST_V2).map((d) => d.model), ['mova.vacuum.v70']);
  });
});

describe('MIOT sendCommand bodies', () => {
  async function readyClient() {
    const http = createCloudMock();
    const client = createClient(http);
    await client.login();
    await client.listDevices();
    return { http, client };
  }

  it('start-vacuum writes vacuum cleaning mode then start action', async () => {
    const { http, client } = await readyClient();
    const before = commandBodies(http).length;
    await client.startVacuum(DID);
    const added = commandBodies(http).slice(before);
    assert.equal(added.length, 2);

    const modeWrite = added[0];
    assert.equal(modeWrite.data.method, 'set_properties');
    assert.equal(modeWrite.data.params[0].siid, MIOT_PROPERTIES.cleaningMode.siid);
    assert.equal(modeWrite.data.params[0].piid, MIOT_PROPERTIES.cleaningMode.piid);
    assert.equal(modeWrite.data.params[0].value, CLEANING_MODE.VACUUM);
    assert.equal(modeWrite.data.params[0].did, DID);

    const start = added[1];
    assert.equal(start.data.method, 'action');
    assert.equal(start.data.params.siid, MIOT_ACTIONS.startClean.siid);
    assert.equal(start.data.params.aiid, MIOT_ACTIONS.startClean.aiid);
    assert.deepEqual(start.data.params.in, []);

    const commandUrl = http.requests.filter((r) => String(r.url).includes('/device/sendCommand'))[0].url;
    assert.equal(commandUrl, 'https://eu.iot.mova-tech.com:13267/dreame-iot-com-20000/device/sendCommand');
  });

  it('start-mop writes mop cleaning mode then start action', async () => {
    const { http, client } = await readyClient();
    const before = commandBodies(http).length;
    await client.startMop(DID, 'mop');
    const added = commandBodies(http).slice(before);
    assert.equal(added.length, 2);
    assert.equal(added[0].data.method, 'set_properties');
    assert.equal(added[0].data.params[0].value, CLEANING_MODE.MOP);
    assert.equal(added[1].data.method, 'action');
    assert.equal(added[1].data.params.siid, MIOT_ACTIONS.startClean.siid);
    assert.equal(added[1].data.params.aiid, MIOT_ACTIONS.startClean.aiid);
  });

  it('start-mop vac_mop writes vacuum-and-mop mode then start action', async () => {
    const { http, client } = await readyClient();
    const before = commandBodies(http).length;
    await client.startMop(DID, 'vac_mop');
    const added = commandBodies(http).slice(before);
    assert.equal(added[0].data.params[0].value, CLEANING_MODE.VACUUM_AND_MOP);
    assert.equal(added[1].data.params.aiid, MIOT_ACTIONS.startClean.aiid);
  });

  it('pause, stop, and dock send the matching MIOT actions', async () => {
    const { http, client } = await readyClient();
    const before = commandBodies(http).length;
    await client.pause(DID);
    await client.stop(DID);
    await client.dock(DID);
    const added = commandBodies(http).slice(before);
    assert.equal(added.length, 3);

    assert.equal(added[0].data.method, 'action');
    assert.equal(added[0].data.params.siid, MIOT_ACTIONS.pauseClean.siid);
    assert.equal(added[0].data.params.aiid, MIOT_ACTIONS.pauseClean.aiid);

    assert.equal(added[1].data.method, 'action');
    assert.equal(added[1].data.params.siid, MIOT_ACTIONS.stopClean.siid);
    assert.equal(added[1].data.params.aiid, MIOT_ACTIONS.stopClean.aiid);

    assert.equal(added[2].data.method, 'action');
    assert.equal(added[2].data.params.siid, MIOT_ACTIONS.charge.siid);
    assert.equal(added[2].data.params.aiid, MIOT_ACTIONS.charge.aiid);
  });

  it('locate, empty, and wash send the matching MIOT actions', async () => {
    const { http, client } = await readyClient();
    const before = commandBodies(http).length;
    await client.locate(DID);
    await client.startAutoEmpty(DID);
    await client.startWashing(DID);
    const added = commandBodies(http).slice(before);
    assert.equal(added.length, 3);

    assert.equal(added[0].data.params.siid, MIOT_ACTIONS.locate.siid);
    assert.equal(added[0].data.params.aiid, MIOT_ACTIONS.locate.aiid);
    assert.equal(added[1].data.params.siid, MIOT_ACTIONS.startAutoEmpty.siid);
    assert.equal(added[1].data.params.aiid, MIOT_ACTIONS.startAutoEmpty.aiid);
    assert.equal(added[2].data.params.siid, MIOT_ACTIONS.startWashing.siid);
    assert.equal(added[2].data.params.aiid, MIOT_ACTIONS.startWashing.aiid);
    assert.deepEqual(added[2].data.params.in, [{ piid: 10, value: '2,1' }]);
  });

  it('set suction and water write the matching MIOT properties', async () => {
    const { http, client } = await readyClient();
    const before = commandBodies(http).length;
    await client.setSuctionLevel(DID, 'turbo');
    await client.setWaterLevel(DID, 'high');
    const added = commandBodies(http).slice(before);
    assert.equal(added[0].data.method, 'set_properties');
    assert.equal(added[0].data.params[0].siid, MIOT_PROPERTIES.suctionLevel.siid);
    assert.equal(added[0].data.params[0].piid, MIOT_PROPERTIES.suctionLevel.piid);
    assert.equal(added[0].data.params[0].value, SUCTION_LEVEL.turbo);
    assert.equal(added[1].data.params[0].siid, MIOT_PROPERTIES.waterFlow.siid);
    assert.equal(added[1].data.params[0].piid, MIOT_PROPERTIES.waterFlow.piid);
    assert.equal(added[1].data.params[0].value, WATER_LEVEL.high);
  });

  it('set CleanGenius writes AutoSwitch SmartHost', async () => {
    const { http, client } = await readyClient();
    const before = commandBodies(http).length;
    await client.setCleanGenius(DID, 'deep');
    const added = commandBodies(http).slice(before);
    assert.equal(added[0].data.method, 'set_properties');
    assert.equal(added[0].data.params[0].siid, MIOT_PROPERTIES.autoSwitchSettings.siid);
    assert.equal(added[0].data.params[0].piid, MIOT_PROPERTIES.autoSwitchSettings.piid);
    assert.deepEqual(JSON.parse(added[0].data.params[0].value), { k: 'SmartHost', v: CLEAN_GENIUS.deep });
  });
});

describe('Homey battery and operational status mapping', () => {
  it('maps representative MIOT battery and state/status values', () => {
    assert.deepEqual(mapDeviceStatusToHomey({ battery: 87, state: 2, status: 2 }), mappedStatus({
      battery: 87,
      operationalStatus: 'cleaning',
      vacuumcleanerState: 'cleaning',
    }));
    assert.deepEqual(mapDeviceStatusToHomey({ battery: 54, state: 5, status: 102, cleaningMode: 1 }), mappedStatus({
      battery: 54,
      operationalStatus: 'mopping',
      vacuumcleanerState: 'cleaning',
    }));
    assert.deepEqual(mapDeviceStatusToHomey({ battery: 71, state: 2, status: 103, cleaningMode: 0 }), mappedStatus({
      battery: 71,
      operationalStatus: 'vacuum_and_mop',
      vacuumcleanerState: 'cleaning',
    }));
    assert.deepEqual(mapDeviceStatusToHomey({ battery: 68, state: 2, status: 2, cleaningMode: 2 }), mappedStatus({
      battery: 68,
      operationalStatus: 'vacuum_and_mop',
      vacuumcleanerState: 'cleaning',
    }));
    assert.deepEqual(mapDeviceStatusToHomey({
      battery: 70,
      state: 2,
      status: 2,
      cleaningMode: 0,
      waterFlow: 2,
      mopPadInstalled: 1,
    }), mappedStatus({
      battery: 70,
      operationalStatus: 'vacuum_and_mop',
      vacuumcleanerState: 'cleaning',
      waterLevel: 'medium',
    }));
    assert.deepEqual(mapDeviceStatusToHomey({ battery: 45, state: 3, status: 3 }), mappedStatus({
      battery: 45,
      operationalStatus: 'returning',
      vacuumcleanerState: 'docked',
    }));
    assert.deepEqual(mapDeviceStatusToHomey({ battery: 40, state: 1, status: 1 }), mappedStatus({
      battery: 40,
      operationalStatus: 'paused',
      vacuumcleanerState: 'stopped',
    }));
    assert.deepEqual(mapDeviceStatusToHomey({ battery: 22, state: 6, status: 6 }), mappedStatus({
      battery: 22,
      operationalStatus: 'charging',
      vacuumcleanerState: 'charging',
    }));
    assert.deepEqual(mapDeviceStatusToHomey({ battery: 100, state: 0, status: 17 }), mappedStatus({
      battery: 100,
      operationalStatus: 'docked',
      vacuumcleanerState: 'docked',
    }));
    assert.deepEqual(mapDeviceStatusToHomey({ battery: 8, state: -1, status: 10 }), mappedStatus({
      battery: 8,
      operationalStatus: 'stopped',
      vacuumcleanerState: 'stopped',
    }));
    assert.equal(mapDeviceStatusToHomey({ battery: 150, state: 0, status: 0 }).battery, 100);
    assert.equal(mapDeviceStatusToHomey({ battery: -4, state: 0, status: 0 }).battery, 0);
  });

  it('maps get_properties fixture output through the shipped client', async () => {
    const http = createCloudMock();
    const client = createClient(http);
    await client.login();
    await client.listDevices();
    const status = await client.getProperties(DID);
    const mapped = mapDeviceStatusToHomey(status);
    assert.equal(status.battery, 76);
    assert.equal(status.state, 5);
    assert.equal(status.status, 102);
    assert.equal(mapped.battery, 76);
    assert.equal(mapped.operationalStatus, 'mopping');
    assert.equal(mapped.vacuumcleanerState, 'cleaning');
    assert.equal(mapped.onoff, true);
    assert.equal(mapped.suctionLevel, 'standard');
    assert.equal(mapped.waterLevel, 'medium');
    assert.equal(mapped.error, false);
    assert.equal(mapped.cleaningTime, 14);
    assert.equal(mapped.cleanedArea, 22);
    assert.equal(mapped.cleanGenius, 'routine');
    assert.equal(mapped.mainBrush, 82);
    assert.equal(mapped.sideBrush, 64);
    assert.equal(mapped.filter, 41);
    assert.equal(mapped.mopPad, 90);
    assert.equal(mapped.sensor, 18);
    assert.equal(mapped.consumableLow, true);
  });
});

describe('MOVAhome consumables', () => {
  it('requests remaining-life percentages for brush, filter, mop, and sensors', async () => {
    const http = createCloudMock();
    const client = createClient(http);
    await client.login();
    await client.listDevices();
    await client.getProperties(DID);
    const getReq = http.requests.filter((request) => {
      if (!String(request.url).includes('/device/sendCommand')) {
        return false;
      }
      const parsed = JSON.parse(request.body);
      return parsed.data && parsed.data.method === 'get_properties';
    }).pop();
    const params = JSON.parse(getReq.body).data.params;
    assert.ok(params.some((prop) => prop.siid === MIOT_PROPERTIES.mainBrushLeft.siid && prop.piid === MIOT_PROPERTIES.mainBrushLeft.piid));
    assert.ok(params.some((prop) => prop.siid === MIOT_PROPERTIES.sideBrushLeft.siid && prop.piid === MIOT_PROPERTIES.sideBrushLeft.piid));
    assert.ok(params.some((prop) => prop.siid === MIOT_PROPERTIES.filterLeft.siid && prop.piid === MIOT_PROPERTIES.filterLeft.piid));
    assert.ok(params.some((prop) => prop.siid === MIOT_PROPERTIES.mopPadLeft.siid && prop.piid === MIOT_PROPERTIES.mopPadLeft.piid));
    assert.ok(params.some((prop) => prop.siid === MIOT_PROPERTIES.sensorLeft.siid && prop.piid === MIOT_PROPERTIES.sensorLeft.piid));
    assert.ok(params.some((prop) => prop.siid === MIOT_PROPERTIES.cleaningTime.siid && prop.piid === MIOT_PROPERTIES.cleaningTime.piid));
    assert.ok(params.some((prop) => prop.siid === MIOT_PROPERTIES.cleanedArea.siid && prop.piid === MIOT_PROPERTIES.cleanedArea.piid));
    assert.ok(params.some((prop) => prop.siid === MIOT_PROPERTIES.autoSwitchSettings.siid && prop.piid === MIOT_PROPERTIES.autoSwitchSettings.piid));
  });

  it('resets a consumable with the matching MIOT action', async () => {
    const http = createCloudMock();
    const client = createClient(http);
    await client.login();
    await client.listDevices();
    const before = commandBodies(http).length;
    await client.resetConsumable(DID, 'mainBrush');
    const added = commandBodies(http).slice(before);
    assert.equal(added.length, 1);
    assert.equal(added[0].data.method, 'action');
    assert.equal(added[0].data.params.siid, MIOT_ACTIONS.resetMainBrush.siid);
    assert.equal(added[0].data.params.aiid, MIOT_ACTIONS.resetMainBrush.aiid);
  });

  it('uses mop water / mop-pad presence so Dreame mode 2 is vacuum & mop', () => {
    assert.equal(
      mapDeviceStatusToHomey({ battery: 80, state: 2, status: 2, cleaningMode: 2 }).operationalStatus,
      'vacuum_and_mop',
    );
    assert.equal(
      mapDeviceStatusToHomey({
        battery: 80,
        state: 2,
        status: 2,
        cleaningMode: 0,
        mopPadInstalled: 1,
      }).operationalStatus,
      'vacuum_and_mop',
    );
    assert.equal(
      mapDeviceStatusToHomey({
        battery: 80,
        state: 2,
        status: 2,
        cleaningMode: 2,
        mopPadInstalled: 0,
        waterFlow: 0,
        waterTank: 0,
      }).operationalStatus,
      'cleaning',
    );
  });

  it('keeps Homey onoff on until the robot is docked or charging', () => {
    assert.equal(mapOnoff('cleaning'), true);
    assert.equal(mapOnoff('mopping'), true);
    assert.equal(mapOnoff('vacuum_and_mop'), true);
    assert.equal(mapOnoff('paused'), true);
    assert.equal(mapOnoff('returning'), true);
    assert.equal(mapOnoff('stopped'), true);
    assert.equal(mapOnoff('docked'), false);
    assert.equal(mapOnoff('charging'), false);
    assert.equal(mapDeviceStatusToHomey({ battery: 45, state: 3, status: 3 }).onoff, true);
    assert.equal(mapDeviceStatusToHomey({ battery: 40, state: 1, status: 1 }).onoff, true);
    assert.equal(mapDeviceStatusToHomey({ battery: 100, state: 0, status: 17 }).onoff, false);
    assert.equal(mapDeviceStatusToHomey({ battery: 22, state: 6, status: 6 }).onoff, false);
    assert.equal(mapDeviceStatusToHomey({ battery: 80, state: 9, status: 105 }).onoff, false);
    assert.equal(mapDeviceStatusToHomey({ battery: 8, state: 4, status: 12 }).onoff, true);
  });

  it('maps suction, water, error, and session stats', () => {
    assert.deepEqual(mapDeviceStatusToHomey({
      battery: 80,
      state: 2,
      status: 2,
      suctionLevel: 3,
      waterFlow: 1,
      errorCode: 12,
      cleaningTime: 9,
      cleanedArea: 31,
    }), mappedStatus({
      battery: 80,
      operationalStatus: 'vacuum_and_mop',
      vacuumcleanerState: 'cleaning',
      suctionLevel: 'turbo',
      waterLevel: 'low',
      error: true,
      cleaningTime: 9,
      cleanedArea: 31,
    }));
    assert.equal(mapDeviceStatusToHomey({ battery: 80, state: 0, status: 17, suctionLevel: 9 }).suctionLevel, null);
    assert.equal(mapDeviceStatusToHomey({ battery: 80, state: 0, status: 17, waterFlow: 0 }).waterLevel, null);
  });

  it('maps CleanGenius from AutoSwitch SmartHost payloads', () => {
    assert.equal(mapCleanGenius(0), 'off');
    assert.equal(mapCleanGenius(1), 'routine');
    assert.equal(mapCleanGenius(2), 'deep');
    assert.equal(mapCleanGenius('{"SmartHost":2}'), 'deep');
    assert.equal(mapCleanGenius({ k: 'SmartHost', v: 0 }), 'off');
    assert.equal(mapCleanGenius({ SmartHost: 1, CleanRoute: 4 }), 'routine');
    assert.equal(mapDeviceStatusToHomey({
      battery: 100,
      state: 0,
      status: 17,
      cleanGenius: 2,
    }).cleanGenius, 'deep');
  });

  it('treats remaining life over 100 as missing and flags low wear', () => {
    assert.deepEqual(mapDeviceStatusToHomey({
      battery: 80,
      state: 0,
      status: 17,
      mainBrush: 12,
      sideBrush: 250,
      filter: 55,
    }), mappedStatus({
      battery: 80,
      operationalStatus: 'docked',
      vacuumcleanerState: 'docked',
      mainBrush: 12,
      filter: 55,
      consumableLow: true,
    }));
  });
});

describe('Homey SDK v3 app structure', () => {
  it('has a vacuumcleaner driver with MOVAhome credential pairing and named controls', () => {
    const root = path.join(__dirname, '..');
    const app = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/app.json'), 'utf8'));
    assert.equal(app.sdk, 3);
    assert.equal(app.id, 'com.mova.vacuum');

    const driver = JSON.parse(fs.readFileSync(path.join(root, 'drivers/vacuum/driver.compose.json'), 'utf8'));
    assert.equal(driver.class, 'vacuumcleaner');
    assert.ok(driver.pair.some((step) => step.id === 'login'));
    assert.ok(driver.pair.some((step) => step.template === 'list_devices'));
    const loginHtml = fs.readFileSync(path.join(root, 'drivers/vacuum/pair/login.html'), 'utf8');
    assert.match(loginHtml, /region/);
    assert.match(loginHtml, /username/);
    assert.match(loginHtml, /password/);
    assert.match(loginHtml, /MOVAhome/);
    assert.match(loginHtml, /Set a password in the official MOVAhome app first/);
    assert.doesNotMatch(loginHtml, /send_code/);
    assert.doesNotMatch(loginHtml, /method: 'code'/);
    const repairHtml = fs.readFileSync(path.join(root, 'drivers/vacuum/repair/login.html'), 'utf8');
    assert.match(repairHtml, /Set a password in the official MOVAhome app first/);
    assert.doesNotMatch(repairHtml, /send_code/);

    assert.equal(driver.capabilitiesOptions.onoff.icon, '/assets/icons/sparkles.svg');
    assert.equal(driver.capabilitiesOptions.vacuumcleaner_state.uiComponent, null);
    const statusCap = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/capabilities/mova_operational_status.json'), 'utf8'));
    assert.ok(statusCap.values.some((value) => value.id === 'vacuum_and_mop'));
    assert.match(statusCap.values.find((value) => value.id === 'vacuum_and_mop').title.nl, /Stofzuigen en dweilen/);
    assert.ok(fs.existsSync(path.join(root, 'assets/icons/sparkles.svg')));

    for (const capability of [
      'measure_battery',
      'vacuumcleaner_state',
      'mova_operational_status',
      'onoff',
      'mova_start_vac_mop',
      'mova_start_vacuum',
      'mova_start_mop',
      'mova_pause',
      'mova_stop',
      'mova_dock',
      'mova_locate',
      'mova_auto_empty',
      'mova_wash_mop',
      'mova_suction_level',
      'mova_water_flow',
      'mova_cleangenius',
      'mova_cleaning_time',
      'mova_cleaned_area',
      'alarm_generic',
      'measure_main_brush',
      'measure_side_brush',
      'measure_filter',
      'measure_mop',
      'measure_sensor',
      'alarm_consumable',
    ]) {
      assert.ok(driver.capabilities.includes(capability), `missing ${capability}`);
    }
    assert.equal(driver.capabilitiesOptions['button.reset_main_brush'].maintenanceAction, true);
    assert.equal(driver.capabilitiesOptions['button.reset_mop'].maintenanceAction, true);

    const actionCaps = {
      mova_start_vac_mop: '/assets/icons/sparkles.svg',
      mova_start_vacuum: '/assets/icons/start_vacuum.svg',
      mova_start_mop: '/assets/icons/start_mop.svg',
      mova_pause: '/assets/icons/pause.svg',
      mova_stop: '/assets/icons/stop.svg',
      mova_dock: '/assets/icons/dock.svg',
      mova_locate: '/assets/icons/locate.svg',
      mova_auto_empty: '/assets/icons/empty.svg',
      mova_wash_mop: '/assets/icons/wash.svg',
    };
    for (const [id, icon] of Object.entries(actionCaps)) {
      const cap = JSON.parse(fs.readFileSync(path.join(root, `.homeycompose/capabilities/${id}.json`), 'utf8'));
      assert.equal(cap.uiComponent, 'button');
      assert.equal(cap.uiQuickAction, true);
      assert.equal(cap.icon, icon);
      assert.ok(fs.existsSync(path.join(root, icon.slice(1))));
    }

    const deviceSrc = fs.readFileSync(path.join(root, 'drivers/vacuum/device.js'), 'utf8');
    assert.match(deviceSrc, /lib\/mova\/client/);
    assert.match(deviceSrc, /mapDeviceStatusToHomey/);
    assert.match(deviceSrc, /startVacuum/);
    assert.match(deviceSrc, /startMop/);
    assert.match(deviceSrc, /locate/);
    assert.match(deviceSrc, /_onoffValue/);
    assert.match(deviceSrc, /getMapView/);
    const suctionCap = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/capabilities/mova_suction_level.json'), 'utf8'));
    assert.equal(suctionCap.type, 'enum');
    assert.ok(suctionCap.values.some((value) => value.id === 'turbo'));
    const flow = JSON.parse(fs.readFileSync(path.join(root, 'drivers/vacuum/driver.flow.compose.json'), 'utf8'));
    assert.ok(flow.actions.some((action) => action.id === 'locate_vacuum'));
    assert.ok(flow.actions.some((action) => action.id === 'set_suction_level'));
    assert.ok(flow.actions.some((action) => action.id === 'set_water_flow'));
    assert.ok(flow.actions.some((action) => action.id === 'empty_dustbin'));
    assert.ok(flow.actions.some((action) => action.id === 'wash_mop'));
    assert.ok(flow.actions.some((action) => action.id === 'set_cleangenius'));
    assert.ok(flow.conditions.some((condition) => condition.id === 'cleangenius_is'));
    const geniusCap = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/capabilities/mova_cleangenius.json'), 'utf8'));
    assert.equal(geniusCap.type, 'enum');
    assert.ok(geniusCap.values.some((value) => value.id === 'routine'));
    assert.ok(fs.existsSync(path.join(root, 'assets/icons/cleangenius.svg')));
    assert.equal(app.compatibility, '>=12.3.0');
    assert.ok(app.api && app.api.getMap);
    const widget = JSON.parse(fs.readFileSync(path.join(root, 'widgets/map/widget.compose.json'), 'utf8'));
    assert.equal(widget.devices.type, 'app');
    assert.equal(widget.devices.singular, true);
    assert.ok(fs.existsSync(path.join(root, 'widgets/map/public/index.html')));
    assert.ok(fs.existsSync(path.join(root, 'widgets/map/preview-light.png')));
    assert.ok(fs.existsSync(path.join(root, 'widgets/map/preview-dark.png')));
    assert.match(fs.readFileSync(path.join(root, 'widgets/map/public/index.html'), 'utf8'), /onHomeyReady/);
  });
});

function encodeMapFrame({
  frameType = FRAME_I,
  width = 20,
  height = 12,
  pixelSize = 50,
  left = 0,
  top = 0,
  robot = { x: 250, y: 200, angle: 90 },
  charger = { x: 100, y: 100, angle: 0 },
  paint,
  extra,
} = {}) {
  const pixelCount = width * height;
  const extraRaw = extra ? Buffer.from(JSON.stringify(extra), 'utf8') : Buffer.alloc(0);
  const pixels = Buffer.alloc(pixelCount, 0);
  if (frameType === FRAME_I) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        pixels[y * width + x] = 254;
      }
    }
    for (let x = 0; x < width; x += 1) {
      pixels[x] = 255;
      pixels[(height - 1) * width + x] = 255;
    }
    for (let y = 0; y < height; y += 1) {
      pixels[y * width] = 255;
      pixels[y * width + width - 1] = 255;
    }
    if (typeof paint === 'function') {
      paint(pixels, width, height);
    }
  }
  const bodySize = frameType === FRAME_I ? pixelCount : 0;
  const buf = Buffer.alloc(HEADER_SIZE + bodySize + extraRaw.length);
  buf.writeInt16LE(1, 0);
  buf.writeInt16LE(7, 2);
  buf.writeInt8(frameType, 4);
  buf.writeInt16LE(robot.x, 5);
  buf.writeInt16LE(robot.y, 7);
  buf.writeInt16LE(robot.angle, 9);
  buf.writeInt16LE(charger.x, 11);
  buf.writeInt16LE(charger.y, 13);
  buf.writeInt16LE(charger.angle, 15);
  buf.writeInt16LE(pixelSize, 17);
  buf.writeInt16LE(width, 19);
  buf.writeInt16LE(height, 21);
  buf.writeInt16LE(left * pixelSize, 23);
  buf.writeInt16LE(top * pixelSize, 25);
  if (frameType === FRAME_I) {
    pixels.copy(buf, HEADER_SIZE);
    extraRaw.copy(buf, HEADER_SIZE + pixelCount);
  } else {
    extraRaw.copy(buf, HEADER_SIZE);
  }
  return {
    raw: buf,
    compressed: zlib.deflateSync(buf),
    base64: zlib.deflateSync(buf).toString('base64'),
  };
}

describe('MOVAhome map frames', () => {
  it('decodes an I-frame into floor cells, robot, charger, and path', () => {
    const frame = encodeMapFrame({
      extra: { tr: 'S100,100L150,100' },
    });
    const decoded = decodeMapPayload(frame.base64);
    assert.equal(decoded.frameType, 'I');
    assert.equal(decoded.header.width, 20);
    assert.equal(decoded.header.height, 12);
    assert.ok(decoded.pixels);
    assert.equal(decoded.robot.x, 5);
    assert.equal(decoded.robot.y, 7);
    assert.equal(decoded.robot.angle, 90);
    assert.equal(decoded.charger.x, 2);
    assert.equal(decoded.charger.y, 9);
    assert.ok(decoded.path.length >= 2);

    const view = serializeMapView(toViewModel(decoded));
    assert.equal(view.ok, true);
    assert.equal(view.width, 20);
    assert.equal(view.height, 12);
    assert.equal(view.cells[0], 2);
    assert.equal(view.cells[1 * 20 + 1], 1);
    const roomMap = decodeMapPayload(encodeMapFrame({
      paint: (pixels, width) => {
        pixels[1 * width + 1] = 3;
        pixels[1 * width + 2] = 128 + 3;
      },
    }).base64);
    const roomView = toViewModel(roomMap);
    assert.equal(roomView.cells[1 * 20 + 1], 1);
    assert.equal(roomView.cells[1 * 20 + 2], 2);
    assert.equal(view.robot.x, 5);
    assert.equal(view._source, undefined);
  });

  it('overlays a P-frame robot pose on a previous I-frame', () => {
    const iFrame = decodeMapPayload(encodeMapFrame().base64);
    const previous = toViewModel(iFrame);
    const pFrame = decodeMapPayload(encodeMapFrame({
      frameType: FRAME_P,
      robot: { x: 400, y: 150, angle: 0 },
    }).base64);
    assert.equal(pFrame.frameType, 'P');
    assert.equal(pFrame.pixels, null);
    const view = toViewModel(pFrame, previous);
    assert.equal(view.ok, true);
    assert.equal(view.robot.x, 8);
    assert.equal(view.cells.length, previous.cells.length);
  });

  it('reads an object name from JSON and strips the comma suffix', () => {
    assert.equal(objectNameFromValue('folder/map.bin,secret'), 'folder/map.bin');
    assert.equal(objectNameFromValue(JSON.stringify({ obj_name: 'a/b.bin,xx' })), 'a/b.bin,xx');
    assert.equal(objectNameFromValue([{ obj_name: 'current.bin', current: true }]), 'current.bin');
    assert.equal(objectNameFromValue(JSON.stringify({ object_name: 'saved/map.bin' })), 'saved/map.bin');
    assert.deepEqual(
      objectNamesFromMapFile(Buffer.from(JSON.stringify({
        object_name: 'ali_dreame/SN/list',
        maps: [{ obj_name: 'ali_dreame/SN/floor1' }],
      }))),
      ['ali_dreame/SN/list', 'ali_dreame/SN/floor1'],
    );
    const saved = encodeMapFrame();
    const fromContainer = decodeSavedMapContainer(Buffer.from(JSON.stringify({
      mapstr: [{ id: 0, name: '', angle: '0', map: saved.base64 }],
    })));
    assert.equal(fromContainer.frameType, 'I');
    assert.equal(fromContainer.robot.x, 5);
    assert.equal(objectNameFromValue('[]'), '');
    assert.equal(objectNameFromValue([]), '');
  });
});

describe('MOVAhome map client', () => {
  it('builds a map view from live MIOT mapData', async () => {
    const frame = encodeMapFrame();
    const http = createCloudMock({ mapData: frame.base64 });
    const client = createClient(http);
    await client.login();
    await client.listDevices();
    const view = await client.getMapView(DID, { model: 'mova.vacuum.v70' });
    assert.equal(view.ok, true);
    assert.equal(view.robot.x, 5);
    assert.equal(view.charger.x, 2);
    const mapReq = commandBodies(http).filter((body) => body.data.method === 'get_properties' && body.data.params.some((prop) => prop.siid === 6));
    assert.ok(mapReq.length >= 1);
  });

  it('downloads the OSS map file when only a P-frame and object name are available', async () => {
    const iFrame = encodeMapFrame();
    const pFrame = encodeMapFrame({
      frameType: FRAME_P,
      robot: { x: 350, y: 200, angle: 45 },
    });
    const http = createCloudMock({
      mapData: pFrame.base64,
      objectName: 'user/map.bin,ignored',
    });
    const client = new MovaCloudClient({
      username: USERNAME,
      password: PASSWORD,
      region: 'eu',
      http,
      download: async (url) => {
        assert.equal(url, 'https://oss.example/map.bin');
        return iFrame.compressed;
      },
    });
    await client.login();
    await client.listDevices();
    const view = await client.getMapView(DID, { model: 'mova.vacuum.v70' });
    assert.equal(view.ok, true);
    assert.equal(view.robot.x, 7);
    assert.ok(view.cells.includes(1));
    const downloadReq = http.requests.find((request) => String(request.url).includes(MAP_DOWNLOAD_ENDPOINT));
    assert.ok(downloadReq);
    if (downloadReq.body) {
      const body = JSON.parse(downloadReq.body);
      assert.equal(body.filename, 'user/map.bin');
      assert.equal(body.did, DID);
    } else {
      assert.match(String(downloadReq.url), /filename=user(%2F|\/)map\.bin/);
      assert.match(String(downloadReq.url), /did=2045332002/);
    }
  });
});
