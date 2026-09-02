'use strict';

module.exports = {
  async getMap({ homey, query }) {
    return homey.app.getMapView(query.deviceId || query.id, {
      debug: query.debug === '1' || query.debug === 'true',
    });
  },
};
