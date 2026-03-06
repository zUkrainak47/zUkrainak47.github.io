/**
 * Format milliseconds to a display string.
 * @param {number} ms - Time in milliseconds
 * @param {number|boolean} [digits=2] - Number of decimal digits (or boolean for backward compatibility)
 * @returns {string} Formatted time string
 */
export function formatTime(ms, digits = 2) {
  if (ms === Infinity || ms === -Infinity) return 'DNF';
  if (ms == null || isNaN(ms)) return '-';

  if (digits === true) digits = 2;
  if (digits === false) digits = 0;

  const negative = ms < 0;
  ms = Math.abs(ms);

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  let result = '';
  if (minutes > 0) {
    result = `${minutes}:${String(seconds).padStart(2, '0')}`;
  } else {
    result = `${seconds}`;
  }

  if (digits > 0) {
    if (digits === 1) {
      const tenths = Math.floor((ms % 1000) / 100);
      result += `.${tenths}`;
    } else {
      const centiseconds = Math.floor((ms % 1000) / 10);
      result += `.${String(centiseconds).padStart(2, '0')}`;
    }
  }

  return negative ? `-${result}` : result;
}

/**
 * Format a solve time with penalty indicator.
 * @param {object} solve - Solve object
 * @returns {string}
 */
export function formatSolveTime(solve) {
  let str = '';
  if (solve.penalty === 'DNF') {
    str = 'DNF';
  } else {
    const time = getEffectiveTime(solve);
    str = formatTime(time);
    if (solve.penalty === '+2') str += '+';
  }
  return str;
}

/**
 * Get the effective time for a solve (with penalty applied).
 * @param {object} solve
 * @returns {number}
 */
export function getEffectiveTime(solve) {
  if (solve.penalty === 'DNF') return Infinity;
  if (solve.penalty === '+2') return solve.time + 2000;
  return solve.time;
}

/**
 * Generate a unique ID.
 * @returns {string}
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Format a timestamp to YYYY-MM-DD.
 * @param {number} timestamp
 * @returns {string}
 */
export function formatDate(timestamp) {
  const d = new Date(timestamp);
  return d.toISOString().split('T')[0];
}

/**
 * Format a timestamp to a readable date (e.g., 6 March 2026).
 * @param {number} timestamp
 * @returns {string}
 */
export function formatReadableDate(timestamp) {
  const d = new Date(timestamp);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Format a timestamp to a readable date-time string.
 * @param {number} timestamp
 * @returns {string}
 */
export function formatDateTime(timestamp) {
  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${formatReadableDate(timestamp)}, ${hours}:${minutes}:${seconds}`;
}

/**
 * Parse a duration string like "3d", "2h", "30m" to milliseconds.
 * @param {string} str
 * @returns {number|null} Duration in ms, or null if invalid
 */
export function parseDuration(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();

  const match = str.match(/^(\d+)\s*(d|h|m|w)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

/**
 * Get start of today in ms.
 * @returns {number}
 */
export function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Get start of this week (Monday) in ms.
 * @returns {number}
 */
export function getStartOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Get start of this month in ms.
 * @returns {number}
 */
export function getStartOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Simple event emitter mixin.
 */
export class EventEmitter {
  constructor() {
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  }

  emit(event, ...args) {
    (this._listeners[event] || []).forEach(fn => fn(...args));
  }
}
