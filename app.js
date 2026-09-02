'use strict';

const Homey = require('homey');

class MovaVacuumApp extends Homey.App {
  async onInit() {
    this.log('MOVA Vacuum app is running');
  }

  _vacuumDevices() {
    try {
      return this.homey.drivers.getDriver('vacuum').getDevices();
    } catch (_err) {
      return [];
    }
  }

  findVacuumDevice(deviceId) {
    const devices = this._vacuumDevices();
    if (deviceId) {
      const wanted = String(deviceId);
      const match = devices.find((device) => device.getId() === wanted)
        || devices.find((device) => String(device.getData().id) === wanted);
      if (match) {
        return match;
      }
    }
    if (devices.length === 1) {
      return devices[0];
    }
    return null;
  }

  async getMapView(deviceId, options = {}) {
    const devices = this._vacuumDevices();
    const device = this.findVacuumDevice(deviceId);
    if (!device) {
      return {
        ok: false,
        error: devices.length === 0 ? 'no_device' : 'select_device',
        devices: devices.map((item) => ({
          id: item.getId(),
          name: item.getName(),
        })),
      };
    }
    return device.getMapView(options);
  }
}

module.exports = MovaVacuumApp;
