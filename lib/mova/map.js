'use strict';

const zlib = require('zlib');

const HEADER_SIZE = 27;
const FRAME_I = 73;
const FRAME_P = 80;
const INVALID_POS = 32767;
const PIXEL_WALL = 255;
const PIXEL_FLOOR = 254;
const MAX_VIEW = 160;

function readI16(buf, offset) {
  return buf.readInt16LE(offset);
}

function looksLikeMapHeader(buf) {
  if (!buf || buf.length < HEADER_SIZE) {
    return false;
  }
  const frameType = buf.readInt8(4);
  if (frameType !== FRAME_I && frameType !== FRAME_P) {
    return false;
  }
  const width = readI16(buf, 19);
  const height = readI16(buf, 21);
  return width > 0 && width < 4096 && height > 0 && height < 4096;
}

function tryInflate(buf) {
  try {
    return zlib.inflateSync(buf);
  } catch (_err) {
    try {
      return zlib.inflateRawSync(buf);
    } catch (_err2) {
      try {
        return zlib.gunzipSync(buf);
      } catch (_err3) {
        return null;
      }
    }
  }
}

function inflateMapString(raw) {
  if (Buffer.isBuffer(raw)) {
    if (looksLikeMapHeader(raw)) {
      return raw;
    }
    const inflated = tryInflate(raw);
    if (inflated && inflated.length) {
      return inflated;
    }
    return decodeBase64Map(raw.toString('utf8'));
  }
  return decodeBase64Map(String(raw || ''));
}

function decodeBase64Map(text) {
  let payload = String(text || '').trim();
  if (!payload) {
    throw new Error('Empty MOVAhome map payload');
  }
  if (payload.includes(',')) {
    payload = payload.split(',')[0];
  }
  payload = payload.replace(/_/g, '/').replace(/-/g, '+');
  const buf = Buffer.from(payload, 'base64');
  try {
    return zlib.inflateSync(buf);
  } catch (_err) {
    try {
      return zlib.inflateRawSync(buf);
    } catch (_err2) {
      return buf;
    }
  }
}

function parseHeader(buf) {
  if (!buf || buf.length < HEADER_SIZE) {
    throw new Error('MOVAhome map header is too short');
  }
  const pixelSize = readI16(buf, 17) || 50;
  const width = readI16(buf, 19);
  const height = readI16(buf, 21);
  return {
    mapIndex: readI16(buf, 0),
    frameId: readI16(buf, 2),
    frameType: buf.readInt8(4),
    robot: {
      x: readI16(buf, 5),
      y: readI16(buf, 7),
      angle: readI16(buf, 9),
    },
    charger: {
      x: readI16(buf, 11),
      y: readI16(buf, 13),
      angle: readI16(buf, 15),
    },
    pixelSize,
    width,
    height,
    left: Math.round(readI16(buf, 23) / pixelSize),
    top: Math.round(readI16(buf, 25) / pixelSize),
  };
}

function isValidPoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && point.x !== INVALID_POS
    && point.y !== INVALID_POS;
}

function worldToCell(point, header) {
  if (!isValidPoint(point) || !header.pixelSize) {
    return null;
  }
  const x = Math.round(point.x / header.pixelSize - header.left);
  const y = Math.round(header.height - 1 - (point.y / header.pixelSize - header.top));
  return { x, y, angle: point.angle || 0 };
}

function classifyPixel(value) {
  const n = value & 0xff;
  if (n === 0) {
    return 0;
  }
  if (n === PIXEL_WALL || n === 251 || (n >= 128 && n < PIXEL_FLOOR)) {
    return 2;
  }
  return 1;
}

function parsePath(tr, header) {
  if (!tr || typeof tr !== 'string') {
    return [];
  }
  const points = [];
  const re = /([SL])(-?\d+),(-?\d+)/g;
  let current = { x: 0, y: 0 };
  let match;
  while ((match = re.exec(tr))) {
    const op = match[1];
    const dx = Number(match[2]);
    const dy = Number(match[3]);
    if (op === 'S') {
      current = { x: dx, y: dy };
    } else {
      current = { x: current.x + dx, y: current.y + dy };
    }
    const cell = worldToCell(current, header);
    if (cell) {
      points.push(cell);
    }
  }
  return points.slice(-400);
}

function downsample(pixels, width, height) {
  const longest = Math.max(width, height, 1);
  const scale = longest > MAX_VIEW ? longest / MAX_VIEW : 1;
  const w = Math.max(1, Math.round(width / scale));
  const h = Math.max(1, Math.round(height / scale));
  const cells = new Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x * scale));
      const sy = Math.min(height - 1, Math.floor(y * scale));
      cells[y * w + x] = classifyPixel(pixels[sy * width + sx]);
    }
  }
  return { cells, width: w, height: h, scale };
}

function scalePoint(point, scale, srcHeight, destHeight) {
  if (!point) {
    return null;
  }
  return {
    x: point.x / scale,
    y: destHeight - 1 - ((srcHeight - 1 - point.y) / scale),
    angle: point.angle || 0,
  };
}

function decodeMapPayload(raw) {
  const buf = inflateMapString(raw);
  const header = parseHeader(buf);
  const pixelCount = header.width * header.height;
  let extra = {};
  let pixels = null;
  if (header.frameType === FRAME_I && buf.length >= HEADER_SIZE + pixelCount && header.width > 0 && header.height > 0) {
    pixels = buf.subarray(HEADER_SIZE, HEADER_SIZE + pixelCount);
    const extraRaw = buf.subarray(HEADER_SIZE + pixelCount).toString('utf8').trim();
    if (extraRaw.startsWith('{')) {
      try {
        extra = JSON.parse(extraRaw);
      } catch (_err) {
        extra = {};
      }
    }
  }
  const robotPoint = (extra.robot && Array.isArray(extra.robot) && extra.robot.length >= 2)
    ? { x: extra.robot[0], y: extra.robot[1], angle: extra.robot[2] || header.robot.angle }
    : header.robot;
  const chargerPoint = (extra.charger && Array.isArray(extra.charger) && extra.charger.length >= 2)
    ? { x: extra.charger[0], y: extra.charger[1], angle: extra.charger[2] || header.charger.angle }
    : header.charger;

  return {
    header,
    frameType: header.frameType === FRAME_P ? 'P' : 'I',
    pixels,
    extra,
    robot: worldToCell(robotPoint, header),
    charger: worldToCell(chargerPoint, header),
    path: parsePath(extra.tr, header),
  };
}

function toViewModel(decoded, previous) {
  const source = (decoded && decoded.pixels)
    ? decoded
    : (previous && previous._source) || decoded;
  if (!source || !source.header) {
    return { ok: false, error: 'No map data' };
  }
  const header = source.header;
  const sampled = source.pixels
    ? downsample(source.pixels, header.width, header.height)
    : {
      cells: (previous && previous.cells) || [],
      width: (previous && previous.width) || 0,
      height: (previous && previous.height) || 0,
      scale: (previous && previous._scale) || 1,
    };

  const robotSrc = (decoded && decoded.robot) || source.robot;
  const chargerSrc = (decoded && decoded.charger) || source.charger;
  const pathSrc = (decoded && decoded.path && decoded.path.length)
    ? decoded.path
    : (source.path || []);

  return {
    ok: sampled.cells.length > 0,
    width: sampled.width,
    height: sampled.height,
    cells: sampled.cells,
    robot: scalePoint(robotSrc, sampled.scale, header.height, sampled.height),
    charger: scalePoint(chargerSrc, sampled.scale, header.height, sampled.height),
    path: pathSrc.map((point) => scalePoint(point, sampled.scale, header.height, sampled.height)).filter(Boolean),
    frameType: decoded.frameType || source.frameType,
    _source: source,
    _scale: sampled.scale,
  };
}

function extractMapProperty(results, siid, piid) {
  if (!Array.isArray(results)) {
    return undefined;
  }
  const match = results.find((item) => item && item.siid === siid && item.piid === piid);
  if (!match) {
    return undefined;
  }
  if (match.value === undefined || match.value === null || match.value === '') {
    return undefined;
  }
  return match.value;
}

function filenameFrom(value) {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value.split(',')[0];
  }
  if (typeof value === 'object') {
    return value.obj_name || value.object_name || value.filename || value.objectName || '';
  }
  return String(value);
}

function objectNameFromValue(value) {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        const name = objectNameFromValue(parsed);
        if (name) {
          return name;
        }
        if (parsed && typeof parsed === 'object') {
          return '';
        }
      } catch (_err) {
        return trimmed.split(',')[0];
      }
    }
    return trimmed.split(',')[0];
  }
  if (Array.isArray(value)) {
    return objectNameFromMapList(value);
  }
  if (typeof value === 'object') {
    return filenameFrom(value) || objectNameFromMapList(value);
  }
  return String(value);
}

function objectNameFromMapList(value) {
  if (!value) {
    return '';
  }
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (_err) {
      return '';
    }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed && (parsed.maps || parsed.list || parsed.records)) || [];
  if (!Array.isArray(list) || list.length === 0) {
    return filenameFrom(parsed);
  }
  const current = list.find((item) => item && (item.current || item.active || item.selected || item.isCurrent)) || list[0];
  if (typeof current === 'string') {
    return current.split(',')[0];
  }
  return filenameFrom(current);
}

function collectObjectNames(value, found = []) {
  if (!value) {
    return found;
  }
  if (typeof value === 'string') {
    const name = objectNameFromValue(value);
    if (name && name.includes('/') && !/^https?:\/\//.test(name) && !found.includes(name)) {
      found.push(name);
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjectNames(item, found));
    return found;
  }
  if (typeof value === 'object') {
    const direct = filenameFrom(value);
    if (direct && direct.includes('/') && !/^https?:\/\//.test(direct) && !found.includes(direct)) {
      found.push(direct);
    }
    Object.keys(value).forEach((key) => {
      if (key === 'url' || key === 'md5') {
        return;
      }
      collectObjectNames(value[key], found);
    });
  }
  return found;
}

function decodeSavedMapContainer(raw) {
  let buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
  if (!looksLikeMapHeader(buf)) {
    const inflated = tryInflate(buf);
    if (inflated && inflated.length) {
      buf = inflated;
    }
  }
  if (looksLikeMapHeader(buf)) {
    return decodeMapPayload(buf);
  }
  const text = buf.toString('utf8').trim();
  const jsonText = text.startsWith('{') || text.startsWith('[')
    ? text
    : (text.match(/[{[][\s\S]*[}\]]/) || [])[0];
  if (!jsonText) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (_err) {
    return null;
  }
  const entries = [];
  if (Array.isArray(parsed)) {
    entries.push(...parsed);
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.mapstr)) {
      entries.push(...parsed.mapstr);
    }
    if (Array.isArray(parsed.maps)) {
      entries.push(...parsed.maps);
    }
    if (parsed.map) {
      entries.push(parsed);
    }
  }
  for (const entry of entries) {
    const payload = typeof entry === 'string'
      ? entry
      : entry && (entry.map || entry.mapstr || entry.mapData || entry.data);
    if (!payload) {
      continue;
    }
    try {
      const decoded = decodeMapPayload(payload);
      if (decoded && decoded.pixels) {
        return decoded;
      }
    } catch (_err) {
      // try next saved map
    }
  }
  return null;
}

function objectNamesFromMapFile(raw) {
  let buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
  if (!looksLikeMapHeader(buf)) {
    const inflated = tryInflate(buf);
    if (inflated && inflated.length) {
      buf = inflated;
    }
  }
  if (looksLikeMapHeader(buf)) {
    return [];
  }
  const text = buf.toString('utf8').trim();
  const start = text.startsWith('{') || text.startsWith('[')
    ? text
    : (text.match(/[{[][\s\S]*[}\]]/) || [])[0];
  if (!start) {
    return [];
  }
  try {
    return collectObjectNames(JSON.parse(start));
  } catch (_err) {
    return [];
  }
}

function serializeMapView(view, extra = {}) {
  const debugFields = {};
  if (view && view.debug) {
    debugFields.debug = view.debug;
  }
  if (view && view.objectName) {
    debugFields.objectName = view.objectName;
  }
  if (!view || !view.ok) {
    return {
      ok: false,
      error: (view && view.error) || 'No map data',
      ...debugFields,
      ...extra,
    };
  }
  return {
    ok: true,
    width: view.width,
    height: view.height,
    cells: view.cells,
    robot: view.robot || null,
    charger: view.charger || null,
    path: Array.isArray(view.path) ? view.path : [],
    frameType: view.frameType || 'I',
    ...debugFields,
    ...extra,
  };
}

module.exports = {
  HEADER_SIZE,
  FRAME_I,
  FRAME_P,
  inflateMapString,
  parseHeader,
  decodeMapPayload,
  toViewModel,
  extractMapProperty,
  objectNameFromValue,
  objectNameFromMapList,
  objectNamesFromMapFile,
  decodeSavedMapContainer,
  serializeMapView,
  worldToCell,
};
