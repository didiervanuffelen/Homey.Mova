'use strict';

const {
  CLEANING_MODE,
  CONSUMABLE_LOW_PERCENT,
  MovaState,
  MovaStatus,
  SUCTION_LEVEL,
  WATER_LEVEL,
  CLEAN_GENIUS,
  AUTO_SWITCH_CLEAN_GENIUS_KEY,
} = require('./constants');

const SUCTION_LEVEL_BY_VALUE = Object.fromEntries(
  Object.entries(SUCTION_LEVEL).map(([name, value]) => [value, name]),
);
const WATER_LEVEL_BY_VALUE = Object.fromEntries(
  Object.entries(WATER_LEVEL).map(([name, value]) => [value, name]),
);
const CLEAN_GENIUS_BY_VALUE = Object.fromEntries(
  Object.entries(CLEAN_GENIUS).map(([name, value]) => [value, name]),
);

const OPERATIONAL_STATUS = {
  CLEANING: 'cleaning',
  MOPPING: 'mopping',
  VACUUM_AND_MOP: 'vacuum_and_mop',
  PAUSED: 'paused',
  RETURNING: 'returning',
  DOCKED: 'docked',
  CHARGING: 'charging',
  STOPPED: 'stopped',
};

const HIGH_CONFIDENCE_CLEANING_STATES = new Set([
  MovaState.Cleaning,
  MovaState.Mopping,
]);

const ACTIVE_CLEANING_STATES = new Set([
  MovaState.Cleaning,
  MovaState.Mopping,
  MovaState.ZonedCleaning,
  MovaState.SpotCleaning,
  MovaState.ManualCleaning,
  MovaState.CruiseRunning,
  MovaState.SecondCleaning,
  MovaState.CleaningAutoEmpty,
  MovaState.HumanFollowing,
]);

const ACTIVE_CLEANING_STATUSES = new Set([
  MovaStatus.Cleaning,
  MovaStatus.PartCleaning,
  MovaStatus.FollowWall,
  MovaStatus.SegmentCleaning,
  MovaStatus.ZoneCleaning,
  MovaStatus.SpotCleaning,
  MovaStatus.Sweeping,
  MovaStatus.Mopping,
  MovaStatus.SweepingAndMopping,
  MovaStatus.SummonClean,
  MovaStatus.Shortcut,
]);

const PAUSED_STATES = new Set([
  MovaState.Paused,
  MovaState.StationPaused,
  MovaState.ManualPaused,
  MovaState.ZonedPaused,
  MovaState.SpotCleaningPaused,
  MovaState.DustBagDryingPaused,
]);

const MOPPING_STATES = new Set([MovaState.Mopping]);
const MOPPING_STATUSES = new Set([MovaStatus.Mopping]);

const CHARGING_STATES = new Set([MovaState.Charging]);
const CHARGING_STATUSES = new Set([MovaStatus.Charging]);

const DOCKED_STATUSES = new Set([
  MovaStatus.Idle,
  MovaStatus.Sleeping,
  MovaStatus.Standby,
  MovaStatus.ChargingComplete,
  MovaStatus.Drying,
  MovaStatus.Washing,
  MovaStatus.SelfWashing,
  MovaStatus.SelfDrying,
  MovaStatus.AutoEmptying,
  MovaStatus.FillingWater,
  MovaStatus.CleanSummarizing,
  MovaStatus.StationReset,
  MovaStatus.WaterDraining,
  MovaStatus.DryingStart,
  MovaStatus.BackWashing,
]);

const DOCKED_STATES = new Set([
  MovaState.Idle,
  MovaState.Drying,
  MovaState.Dormant,
  MovaState.Washing,
  MovaState.Sleeping,
  MovaState.WaitingForTask,
  MovaState.Defecating,
  MovaState.Emptying,
  MovaState.Draining,
  MovaState.StationCleaning,
  MovaState.DustBagDrying,
  MovaState.AutoWaterDraining,
]);

const RETURNING_STATES = new Set([
  MovaState.Returning,
  MovaState.GoCharging,
  MovaState.ReturningAutoEmpty,
  MovaState.ReturningToDrain,
]);

const RETURNING_STATUSES = new Set([
  MovaStatus.BackHome,
  MovaStatus.ReturningWashing,
  MovaStatus.ReturningDrain,
]);

const STOPPED_STATUSES = new Set([
  MovaStatus.PowerOff,
  MovaStatus.OTA,
  MovaStatus.Factory,
  MovaStatus.WifiSet,
  MovaStatus.Upgrading,
]);

function clampBattery(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return null;
  }
  return Math.round(n);
}

function clampNonNegative(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n);
}

function isActivelyCleaning({ state, status }) {
  return HIGH_CONFIDENCE_CLEANING_STATES.has(state)
    || ACTIVE_CLEANING_STATES.has(state)
    || ACTIVE_CLEANING_STATUSES.has(status);
}

function isMopActive({ waterFlow, waterTank, mopPadInstalled } = {}) {
  if (Number(waterFlow) > 0) {
    return true;
  }
  if (mopPadInstalled === true || Number(mopPadInstalled) === 1) {
    return true;
  }
  if (Number(waterTank) === 10) {
    return true;
  }
  if (mopPadInstalled === false || Number(mopPadInstalled) === 0 || Number(waterTank) === 0) {
    return false;
  }
  return null;
}

function mapActiveCleaningKind({
  state,
  status,
  cleaningMode,
  waterFlow,
  waterTank,
  mopPadInstalled,
}) {
  if (status === MovaStatus.SweepingAndMopping) {
    return OPERATIONAL_STATUS.VACUUM_AND_MOP;
  }
  if (MOPPING_STATES.has(state) || MOPPING_STATUSES.has(status)) {
    return OPERATIONAL_STATUS.MOPPING;
  }
  if (status === MovaStatus.Sweeping) {
    return OPERATIONAL_STATUS.CLEANING;
  }

  const mode = Number(cleaningMode);
  if (mode === CLEANING_MODE.MOP) {
    return OPERATIONAL_STATUS.MOPPING;
  }

  const mopActive = isMopActive({ waterFlow, waterTank, mopPadInstalled });
  if (mopActive === true) {
    return OPERATIONAL_STATUS.VACUUM_AND_MOP;
  }
  // Dreame / V70: 2 = vacuum+mop. If mop hardware is explicitly off, keep vacuum-only.
  if (mode === CLEANING_MODE.VACUUM_AND_MOP || mode === CLEANING_MODE.VACUUM_THEN_MOP) {
    return mopActive === false ? OPERATIONAL_STATUS.CLEANING : OPERATIONAL_STATUS.VACUUM_AND_MOP;
  }
  return OPERATIONAL_STATUS.CLEANING;
}

function mapOperationalStatus({
  state,
  status,
  cleaningMode,
  waterFlow,
  waterTank,
  mopPadInstalled,
} = {}) {
  const s = Number.isFinite(Number(state)) ? Number(state) : MovaState.Unknown;
  const st = Number.isFinite(Number(status)) ? Number(status) : MovaStatus.Unknown;

  if (st === MovaStatus.Paused || PAUSED_STATES.has(s)) {
    return OPERATIONAL_STATUS.PAUSED;
  }

  if (isActivelyCleaning({ state: s, status: st })) {
    return mapActiveCleaningKind({
      state: s,
      status: st,
      cleaningMode,
      waterFlow,
      waterTank,
      mopPadInstalled,
    });
  }

  if (CHARGING_STATUSES.has(st) || CHARGING_STATES.has(s)) {
    return OPERATIONAL_STATUS.CHARGING;
  }

  if (RETURNING_STATES.has(s) || RETURNING_STATUSES.has(st)) {
    return OPERATIONAL_STATUS.RETURNING;
  }

  if (DOCKED_STATUSES.has(st)) {
    return OPERATIONAL_STATUS.DOCKED;
  }

  if (STOPPED_STATUSES.has(st) || s === MovaState.Error || st === MovaStatus.Error) {
    return OPERATIONAL_STATUS.STOPPED;
  }

  if (DOCKED_STATES.has(s)) {
    return OPERATIONAL_STATUS.DOCKED;
  }

  if (s === MovaState.Unknown && st === MovaStatus.Unknown) {
    return OPERATIONAL_STATUS.STOPPED;
  }

  return OPERATIONAL_STATUS.STOPPED;
}

function mapOnoff(operationalStatus, { state } = {}) {
  if (state === MovaState.StationPaused || state === MovaState.DustBagDryingPaused) {
    return false;
  }
  return operationalStatus !== OPERATIONAL_STATUS.DOCKED
    && operationalStatus !== OPERATIONAL_STATUS.CHARGING;
}

function mapSuctionLevel(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const mapped = SUCTION_LEVEL_BY_VALUE[Number(value)];
  return mapped || null;
}

function mapWaterLevel(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const mapped = WATER_LEVEL_BY_VALUE[Number(value)];
  return mapped || null;
}

function parseAutoSwitchSettings(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return {};
  }
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_err) {
      return {};
    }
  }
  if (Array.isArray(parsed)) {
    const out = {};
    for (const item of parsed) {
      if (item && item.k !== undefined) {
        out[item.k] = item.v;
      }
    }
    return out;
  }
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }
  if (parsed.k !== undefined && parsed.v !== undefined && Object.keys(parsed).length <= 3) {
    return { [parsed.k]: parsed.v };
  }
  return parsed;
}

function mapCleanGenius(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(CLEAN_GENIUS, value)) {
    return value;
  }
  const settings = parseAutoSwitchSettings(value);
  const raw = settings[AUTO_SWITCH_CLEAN_GENIUS_KEY] !== undefined
    ? settings[AUTO_SWITCH_CLEAN_GENIUS_KEY]
    : value;
  if (raw === undefined || raw === null || typeof raw === 'object') {
    return null;
  }
  const mapped = CLEAN_GENIUS_BY_VALUE[Number(raw)];
  return mapped || null;
}

function mapVacuumcleanerState(operationalStatus) {
  switch (operationalStatus) {
    case OPERATIONAL_STATUS.CLEANING:
    case OPERATIONAL_STATUS.MOPPING:
    case OPERATIONAL_STATUS.VACUUM_AND_MOP:
      return 'cleaning';
    case OPERATIONAL_STATUS.CHARGING:
      return 'charging';
    case OPERATIONAL_STATUS.DOCKED:
    case OPERATIONAL_STATUS.RETURNING:
      return 'docked';
    case OPERATIONAL_STATUS.PAUSED:
    case OPERATIONAL_STATUS.STOPPED:
    default:
      return 'stopped';
  }
}

/**
 * Map MIOT battery + operating mode / device status onto Homey-facing values.
 */
function extractConsumables(raw = {}) {
  return {
    mainBrush: clampPercent(raw.mainBrush),
    sideBrush: clampPercent(raw.sideBrush),
    filter: clampPercent(raw.filter),
    mopPad: clampPercent(raw.mopPad),
    sensor: clampPercent(raw.sensor),
  };
}

function isConsumableLow(consumables = {}) {
  return Object.values(consumables).some((value) => value !== null && value <= CONSUMABLE_LOW_PERCENT);
}

function mapDeviceStatusToHomey({
  battery,
  state,
  status,
  cleaningMode,
  suctionLevel,
  waterFlow,
  waterTank,
  mopPadInstalled,
  errorCode,
  cleaningTime,
  cleanedArea,
  cleanGenius,
  ...rest
} = {}) {
  const operationalStatus = mapOperationalStatus({
    state,
    status,
    cleaningMode,
    waterFlow,
    waterTank,
    mopPadInstalled,
  });
  const consumables = extractConsumables(rest);
  return {
    battery: clampBattery(battery),
    operationalStatus,
    vacuumcleanerState: mapVacuumcleanerState(operationalStatus),
    onoff: mapOnoff(operationalStatus, { state }),
    suctionLevel: mapSuctionLevel(suctionLevel),
    waterLevel: mapWaterLevel(waterFlow),
    error: Number(errorCode) > 0,
    cleaningTime: clampNonNegative(cleaningTime),
    cleanedArea: clampNonNegative(cleanedArea),
    cleanGenius: mapCleanGenius(cleanGenius),
    ...consumables,
    consumableLow: isConsumableLow(consumables),
  };
}

function parseMiotPropertyList(results) {
  const values = {};
  if (!Array.isArray(results)) {
    return values;
  }
  for (const item of results) {
    if (!item || item.code !== 0) {
      continue;
    }
    values[`${item.siid}-${item.piid}`] = item.value;
  }
  return values;
}

function miotPropertiesToStatus(results) {
  const values = parseMiotPropertyList(results);
  return {
    state: values['2-1'] !== undefined ? values['2-1'] : MovaState.Unknown,
    status: values['4-1'] !== undefined ? values['4-1'] : MovaStatus.Unknown,
    battery: values['3-1'] !== undefined ? values['3-1'] : 0,
    cleaningMode: values['4-23'],
    chargingState: values['3-2'],
    cleaningTime: values['4-2'],
    cleanedArea: values['4-3'],
    suctionLevel: values['4-4'],
    waterFlow: values['4-5'],
    waterTank: values['4-6'],
    mopPadInstalled: values['4-53'],
    cleanGenius: parseAutoSwitchSettings(values['4-50'])[AUTO_SWITCH_CLEAN_GENIUS_KEY],
    errorCode: values['2-2'] !== undefined ? values['2-2'] : 0,
    mainBrush: values['9-2'],
    sideBrush: values['10-2'],
    filter: values['11-1'],
    sensor: values['16-1'],
    mopPad: values['18-1'],
  };
}

module.exports = {
  OPERATIONAL_STATUS,
  clampBattery,
  clampPercent,
  clampNonNegative,
  isMopActive,
  extractConsumables,
  isConsumableLow,
  mapOperationalStatus,
  mapOnoff,
  mapSuctionLevel,
  mapWaterLevel,
  parseAutoSwitchSettings,
  mapCleanGenius,
  mapVacuumcleanerState,
  mapDeviceStatusToHomey,
  parseMiotPropertyList,
  miotPropertiesToStatus,
};
