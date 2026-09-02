'use strict';

const Homey = require('homey');
const { MovaCloudClient } = require('../../lib/mova/client');
const { toHomeyStoreDevice } = require('../../lib/mova/devices');
const { normalizeRegion } = require('../../lib/mova/constants');

class MovaVacuumDriver extends Homey.Driver {
  async onInit() {
    this.log('MOVA Vacuum driver initialized');

    this.homey.flow.getActionCard('start_vacuum').registerRunListener(async (args) => {
      await args.device.startVacuum();
    });

    this.homey.flow.getActionCard('start_mop').registerRunListener(async (args) => {
      await args.device.startMop(args.mode || 'mop');
    });

    this.homey.flow.getActionCard('pause_vacuum').registerRunListener(async (args) => {
      await args.device.pauseCleaning();
    });

    this.homey.flow.getActionCard('stop_vacuum').registerRunListener(async (args) => {
      await args.device.stopCleaning();
    });

    this.homey.flow.getActionCard('dock_vacuum').registerRunListener(async (args) => {
      await args.device.dock();
    });

    this.homey.flow.getActionCard('locate_vacuum').registerRunListener(async (args) => {
      await args.device.locate();
    });

    this.homey.flow.getActionCard('set_suction_level').registerRunListener(async (args) => {
      await args.device.setSuctionLevel(args.level);
    });

    this.homey.flow.getActionCard('set_water_flow').registerRunListener(async (args) => {
      await args.device.setWaterLevel(args.level);
    });

    this.homey.flow.getActionCard('empty_dustbin').registerRunListener(async (args) => {
      await args.device.startAutoEmpty();
    });

    this.homey.flow.getActionCard('wash_mop').registerRunListener(async (args) => {
      await args.device.startWashing();
    });

    this.homey.flow.getActionCard('set_cleangenius').registerRunListener(async (args) => {
      await args.device.setCleanGenius(args.level);
    });

    this.homey.flow.getConditionCard('operational_status_is').registerRunListener(async (args) => {
      return args.device.getCapabilityValue('mova_operational_status') === args.status;
    });

    this.homey.flow.getConditionCard('cleangenius_is').registerRunListener(async (args) => {
      return args.device.getCapabilityValue('mova_cleangenius') === args.level;
    });

    this.operationalStatusTrigger = this.homey.flow.getDeviceTriggerCard('operational_status_changed');
    this.operationalStatusTrigger.registerRunListener(async (args, state) => {
      if (!args.status || args.status === 'any') {
        return true;
      }
      return state.status === args.status;
    });
  }

  _createClient(credentials) {
    return new MovaCloudClient({
      username: credentials.username,
      password: credentials.password,
      region: normalizeRegion(credentials.region),
      logger: this,
    });
  }

  async _loginAndList(credentials) {
    const client = this._createClient(credentials);
    await client.login(credentials.username, credentials.password, credentials.region);
    const vacuums = await client.listDevices();
    return { client, vacuums };
  }

  async onPair(session) {
    let credentials = null;
    let listV2Client = null;

    session.setHandler('login', async (data) => {
      const username = (data.username || '').trim();
      const password = data.password || '';
      const region = normalizeRegion(data.region);
      if (!username || !password) {
        throw new Error('Enter your MOVAhome email, password, and region. Set a password in the MOVAhome app first if you used Apple ID.');
      }

      credentials = { username, password, region };
      const { client, vacuums } = await this._loginAndList(credentials);
      listV2Client = client;
      this.log(`Pairing login ok (${region}), vacuums=${vacuums.length}`);
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!credentials) {
        throw new Error('Not logged in');
      }
      const client = listV2Client || this._createClient(credentials);
      if (!listV2Client) {
        await client.login(credentials.username, credentials.password, credentials.region);
      }
      const vacuums = await client.listDevices();
      const devices = vacuums.map((device) => toHomeyStoreDevice(device, {
        ...credentials,
        session: client.getSession(),
      }));
      this.log(`Pairable MOVAhome vacuums: ${devices.map((d) => d.store.model).join(', ') || '(none)'}`);
      return devices;
    });
  }

  async onRepair(session, device) {
    session.setHandler('login', async (data) => {
      const username = (data.username || '').trim();
      const password = data.password || '';
      const region = normalizeRegion(data.region || device.getStoreValue('region'));
      if (!username || !password) {
        throw new Error('Enter your MOVAhome email, password, and region. Set a password in the MOVAhome app first if you used Apple ID.');
      }

      const client = this._createClient({ username, password, region });
      await client.login(username, password, region);
      const sessionInfo = client.getSession();

      await device.setStoreValue('username', username);
      await device.setStoreValue('password', password);
      await device.setStoreValue('region', region);
      if (sessionInfo) {
        await device.setStoreValue('accessToken', sessionInfo.accessToken);
        await device.setStoreValue('refreshToken', sessionInfo.refreshToken);
        await device.setStoreValue('expiresAt', sessionInfo.expiresAt);
        await device.setStoreValue('uid', sessionInfo.uid);
      }

      if (typeof device.applyCredentials === 'function') {
        await device.applyCredentials({ username, password, region, session: sessionInfo });
      }
      await device.setAvailable();
      this.log(`Repair login ok for ${device.getName()}`);
      return true;
    });
  }
}

module.exports = MovaVacuumDriver;
