/*
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const DAY = 1000 * 60 * 60 * 24;

/**
 * Accepts a date and returns a date string in YYYY-MM-DD format.
 * @param {Date} date
 * @return {string}
 */
function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

export function toISODate(d) {
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6)].join('-');
}

/**
 * Accepts an integer and returns a date string (YYYY-MM-DD) for the given
 * number of days (before or after) the current date (in the user's timezone).
 * @param {number} offset
 * @return {string}
 */
export function dateOffset(offset) {
  const date = new Date();
  const today = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  return toDateString(new Date(today + (offset * DAY)));
}

export function getDatesInRange(startDate, endDate) {
  const dates = [];
  let date = startDate;
  while (date <= endDate) {
    dates.push(date);
    date = toDateString(new Date(DAY + new Date(date).getTime()));
  }
  return dates;
}

/**
 * Escapes an untrusted HTML string.
 * @param {string} unsafe
 * @return {string}
 */
export function e(unsafe) {
  return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
}

export function mergeSortedArrays(r1, r2, getValue) {
  const merged = [];
  let i1 = 0;
  let i2 = 0;

  while (merged.length < r1.length + r2.length) {
    if (i1 < r1.length &&
       (i2 >= r2.length || getValue(r1[i1]) < getValue(r2[i2]))) {
      merged.push(r1[i1++]);
    } else {
      merged.push(r2[i2++]);
    }
  }
  return merged;
}

export class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export function nextFrame() {
  return new Promise(
      (r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

export function timeout(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function hashObj(obj) {
  const text = JSON.stringify(obj);
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function round(num, decimalPlaces) {
  const multiplier = Math.pow(10, decimalPlaces);
  return Math.round(num * multiplier) / multiplier;
}
