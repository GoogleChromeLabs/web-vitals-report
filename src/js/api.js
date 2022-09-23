/*
 * Copyright 2022 Google LLC
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

import {openDB} from 'idb';
import {measureCaughtError} from './analytics.js';
import {getAccessToken, refreshAccessToken} from './auth.js';
import {progress} from './Progress.js';
import {get} from './store.js';
import {dateOffset, Deferred, getDatesInRange, hashObj, mergeSortedArrays, toISODate} from './utils.js';
import {WebVitalsError} from './WebVitalsError.js';


const MANAGEMENT_API_URL =
    'https://www.googleapis.com/analytics/v3/management/';

const REPORTING_API_URL =
    'https://analyticsreporting.googleapis.com/v4/reports:batchGet';


export const PAGE_SIZE = 100000;

const cacheableRows = new WeakSet();

function getAuthHeaders() {
  return {
    'authorization': `Bearer ${getAccessToken()}`,
  };
}

async function makeManagementAPIRequest(method) {
  let rows = [];
  let responseJSON;
  let url = MANAGEMENT_API_URL + method;

  do {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    responseJSON = await response.json();
    rows = rows.concat(responseJSON.items);
  } while (url = responseJSON.nextLink);

  return rows;
}

export function getAccountSummaries() {
  return makeManagementAPIRequest('accountSummaries');
}

let segments;
const segmentMap = new Map();

export async function getSegments() {
  if (!segments) {
    segments = await makeManagementAPIRequest('segments');

    if (!segments || !segments[0]) {
      return;
    }

    for (const segment of segments) {
      // Rename the "Desktop and Tablet Traffic" segment to "Desktop Traffic"
      // for consistency with CrUX and PSI.
      if (segment.name === 'Tablet and Desktop Traffic') {
        segment.name = 'Desktop Traffic';
      }

      // segment.name = sanitizeSegmentName(segment.name);
      segmentMap.set(segment.id, segment.name);
    }
  }
  return segments;
}

/**
 * Note: must not be used before a call to `getSegments()` finishes.
 * @param {string} id
 */
export function getSegmentNameById(id) {
  return segmentMap.get(id);
}

/**
 * Multiple segments can have the same name, so we can't just search through
 * all the segments the user has access to, we have to limit the search to
 * just the segments in the `reportRequest` object.
 * @param {*} segmentName
 * @param {*} reportRequest
 * @return {string|null}
 */
function getSegmentIdByName(segmentName, reportRequest) {
  // Rename the "Desktop and Tablet Traffic" segment to "Desktop Traffic"
  // for consistency with CrUX and PSI.
  if (segmentName === 'Tablet and Desktop Traffic') {
    return '-15';
  }

  for (const segment of reportRequest.segments) {
    const segmentId = segment.segmentId.slice(6); // Remove the `gaid::`.
    if (getSegmentNameById(segmentId) === segmentName) {
      return segmentId;
    }
  }
  // Still here? It could be because the user has changed the name of the
  // segment in GA since this data was cached. In that case, return null
  // and require the data to be re-fetched.
  return null;
}

class SamplingError extends Error {}

class CacheReadError extends Error {
  constructor(error) {
    super(error.message);
    this.originalError = error;
  }
}

let originalReportRequest;
let originalStartDate;
let originalEndDate;

export async function getReport(reportRequest) {
  originalReportRequest = reportRequest;
  originalStartDate = reportRequest.dateRanges[0].startDate;
  originalEndDate = reportRequest.dateRanges[0].endDate;

  let controller = new AbortController();

  try {
    // Sampled responses are never stored in the cached, so for sampled
    // requests there's no need to check there first.
    if (reportRequest.samplingLevel !== 'SMALL') {
      // If any errors are thrown getting
      try {
        return await getReportFromCacheAndAPI(reportRequest, controller);
      } catch (error) {
        if (error instanceof CacheReadError) {
          handleDBError(error.originalError);
        } else {
          throw error;
        }
      }
    }
    return await getReportFromAPI(reportRequest, controller);
  } catch (error) {
    if (error instanceof SamplingError) {
      const sampledReportRequest =
          JSON.parse(JSON.stringify(originalReportRequest));

      // Create a new controller for this new report.
      controller = new AbortController();

      sampledReportRequest.samplingLevel = 'SMALL';

      return await getReportFromAPI(sampledReportRequest, controller);
    } else {
      // Rethrow all errors that are not sampling errors.
      throw error;
    }
  }
}

// Technically it's 10, but we're making it lower just to be safe and account
// for requests from other tools happening at the same time.
// https://developers.google.com/analytics/devguides/reporting/core/v4/limits-quotas
const MAX_CONCURRENT_REQUESTS = 7;

let concurrentRequests = 0;
function incrementConcurrentRequests() {
  concurrentRequests++;
}

const pendingRequestDeferreds = [];
function decrementConcurrentRequests() {
  concurrentRequests--;
  if (pendingRequestDeferreds.length) {
    const deferred = pendingRequestDeferreds.pop();
    deferred.resolve();
  }
}

function concurrentRequestsCountLessThanMax() {
  if (concurrentRequests <= MAX_CONCURRENT_REQUESTS) {
    return;
  }
  const deferred = new Deferred();
  pendingRequestDeferreds.push(deferred);
  return deferred.promise;
}

export async function makeReportingAPIRequest(reportRequest, signal) {
  try {
    incrementConcurrentRequests();
    await concurrentRequestsCountLessThanMax();

    let response = await fetch(REPORTING_API_URL, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        reportRequests: [reportRequest],
      }),
      signal,
    });

    let json = await response.json();

    // If it fails with auth error, then try a refresh and a second attempt
    if (!response.ok && json.error.code === 401) {
        refreshAccessToken();
        response = await fetch(REPORTING_API_URL, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            reportRequests: [reportRequest],
          }),
          signal,
        });

        json = await response.json();
    }

    if (!response.ok) {
        throw new Error(`${json.error.code}: ${json.error.message}`);
    }
    return json.reports[0];
  } finally {
    decrementConcurrentRequests();
  }
}

export async function getReportFromAPI(reportRequest, controller) {
  const rows = await getReportRowsFromAPI(reportRequest, controller);
  const isSampled = reportRequest.samplingLevel === 'SMALL';
  const source = sourcesNameMap[sources.NETWORK];
  return {rows, meta: {source, isSampled}};
}

async function getReportRowsFromAPI(reportRequest, controller) {
  let report;
  let rows = [];

  const segmentDimensionIndex =
      reportRequest.dimensions.findIndex((dim) => dim.name === 'ga:segment');

  const {startDate, endDate} = reportRequest.dateRanges[0];
  const datesInRange = getDatesInRange(startDate, endDate);

  // For non-sampled, multi-day requests that contain today or yesterday,
  // split it up since this report data will likely not be "golden".
  if (endDate != startDate && reportRequest.samplingLevel !== 'SMALL') {
    const yesterday = dateOffset(-1);
    const today = dateOffset(0);
    if (startDate < yesterday && endDate >= yesterday) {
      const dateRanges = [
        {startDate: startDate, endDate: dateOffset(-2)},
        {startDate: yesterday, endDate: yesterday},
      ];
      // If the date range includes the current day, request that separately.
      if (endDate >= today) {
        dateRanges.push({startDate: today, endDate: endDate});
      }
      return await getReportRowsByDatesFromAPI(
          reportRequest, dateRanges, controller);
    }
  }

  progress.total += datesInRange.length;

  try {
    report = await makeReportingAPIRequest(reportRequest, controller.signal);
  } catch (error) {
    // If there is an error, abort all in-progress requests for this report.
    controller.abort();

    // Rethrow the error unless it's an AbortError.
    if (error.name !== 'AbortError') {
      throw error;
    }
  }

  const totalRows = report.data.rowCount;

  const {samplesReadCounts, samplingSpaceSizes} = report.data;
  const sampleRate = samplesReadCounts &&
      (samplesReadCounts[0] / samplingSpaceSizes[0]);

  // True if the report is sampled at all.
  const isSampled = Boolean(sampleRate);

  // True if the report is sampled for a request
  // that didn't specifically ask for sampled results.
  const isAutoSampled = isSampled && reportRequest.samplingLevel !== 'SMALL';

  // If the report is a multi-day report that contains sampled data or more
  // than a million rows, trying breaking it up into one report for each day.
  if (startDate !== endDate && (isAutoSampled || totalRows >= 1e6)) {
    // Deduct the dates in range from the progress total because they're not
    // going to be used. Defer this action to ensure the percentage can
    // increase at a stable rate.
    setTimeout(() => progress.total -= datesInRange.length, 0);

    const dateRanges = datesInRange.map((d) => ({startDate: d, endDate: d}));
    return await getReportRowsByDatesFromAPI(
        reportRequest, dateRanges, controller);
  }

  // If this is a single-day request that's part of a larger report and
  // the results are sampled, throw an error because we can't mixed sample
  // data from one data with sampled data from another day.
  if (isAutoSampled && startDate === endDate &&
      originalStartDate !== originalEndDate) {
    progress.total -= datesInRange.length;
    controller.abort();
    throw new SamplingError();
  }

  // If the response still contains more than 1M rows (even after a retry),
  // throw an error because Google Analytics will truncate all responses
  // with than 1M rows, making the data useless.
  if (totalRows >= 1e6) {
    throw new WebVitalsError('row_limit_exceeded');
  }

  if (report.data.rows) {
    rows = rows.concat(report.data.rows);
  }

  // Queue adding the completed requests to progress until after any
  // paginated requests start.
  setTimeout(() => progress.cur += datesInRange.length, 0);

  // If the response shows a paginated report, fetch the rest in parallel.
  if (report.nextPageToken) {
    let rowCount = rows && rows.length || 0;
    const reportRequests = [];
    while (rowCount < totalRows) {
      const nextReportRequest = JSON.parse(JSON.stringify(reportRequest));
      nextReportRequest.pageToken = String(rowCount);
      reportRequests.push(nextReportRequest);
      rowCount += PAGE_SIZE;
    }

    progress.total += reportRequests.length;

    const pageResults = await Promise.all(reportRequests.map((req) => {
      return makeReportingAPIRequest(req).then((result) => {
        progress.cur++;
        return result;
      });
    }));

    for (const page of pageResults) {
      if (page.data.rows) {
        rows = rows.concat(page.data.rows);
      }
    }
  }

  for (const row of rows) {
    // If the data in the report is "golden" and not sampled, mark it cacheable.
    if (report.data.isDataGolden && !isSampled) {
      cacheableRows.add(row);
    }

    // If the report contains sampled data, Google Analytics will automatically
    // adjust all metric values by the sample rate. In most cases, this is what
    // you want (e.g. if you're reporting total values), but since we're going
    // to be constructing a distribution from these values, we want to the
    // original values as sent.
    if (isSampled) {
      const value = row.metrics[0].values[0];
      row.metrics[0].values[0] = `${Math.round(value * sampleRate)}`;
    }

    // The Reporting API will return the segment name, which is problematic
    // since we're going to be caching the data by segment, and users can change
    // the segment name in GA. Instead, use the segment ID.
    if (segmentDimensionIndex > -1) {
      const segmentId = getSegmentIdByName(
          row.dimensions[segmentDimensionIndex], reportRequest);

      row.dimensions[segmentDimensionIndex] = segmentId;
    }
  }

  return rows;
}

let dbPromise;
addEventListener('pageshow', () => dbPromise = getDB());
addEventListener('pagehide', () => dbPromise.then((db) => db && db.close()));

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB('web-vitals-cache', 3, {
      async upgrade(db, oldVersion, newVersion, transaction) {
        switch (oldVersion) {
          case 0:
            db.createObjectStore('data', {
              keyPath: ['viewId', 'segmentId', 'optsHash', 'date'],
            });
            break;
          case 1:
          case 2:
            // Due to bugs in v1-2, clear all data in the object store
            // because it could be incorrect in some cases.
            await transaction.objectStore('data').clear();
        }
      },
      async blocking() {
        if (dbPromise) {
          const db = await dbPromise;
          db.close();
          dbPromise = null;
        }
      },
    });
  }
  return dbPromise;
}

async function handleDBError(error) {
  measureCaughtError(error);
  if (dbPromise) {
    const db = await dbPromise;
    await db.clear('data');
  }
}

async function getCacheKeys(viewId, segmentId, optsHash, startDate, endDate) {
  const db = await getDB();
  const range = IDBKeyRange.bound(
    [viewId, segmentId, optsHash, startDate],
    [viewId, segmentId, optsHash, endDate],
  );
  return await db.getAllKeys('data', range);
}

async function updateCachedData(viewId, optsHash, rows) {
  const dateData = new Map();
  for (const row of rows) {
    // Only cache rows from reports with "golden" data.
    if (!cacheableRows.has(row)) {
      continue;
    }

    const [segmentId, date] = row.dimensions;

    let segmentData = dateData.get(date);
    if (!segmentData) {
      segmentData = new Map();
      dateData.set(date, segmentData);
    }

    let rowData = segmentData.get(segmentId);
    if (!rowData) {
      rowData = [];
      segmentData.set(segmentId, rowData);
    }

    rowData.push(row);
  }

  const db = await getDB();
  for (const [date, segmentData] of dateData) {
    for (const [segmentId, rows] of segmentData) {
      // An empty set of rows should never exist, but just in case...
      if (rows.length) {
        await db.put('data', {
          viewId,
          segmentId,
          optsHash,
          date: toISODate(date),
          json: JSON.stringify(rows),
        });
      }
    }
  }
}

const sources = {
  CACHE: 1,
  NETWORK: 2,
  MIXED: 3,
};

const sourcesNameMap = Object.fromEntries(
    Object.entries(sources).map(([k, v]) => [v, k.toLowerCase()]));

async function getReportFromCacheAndAPI(reportRequest, controller) {
  const {viewId, segments, dimensions, dimensionFilterClauses} = reportRequest;
  const {startDate, endDate} = reportRequest.dateRanges[0];
  const optsHash = await hashObj({dimensions, dimensionFilterClauses});

  let foundKeys = [];
  try {
    foundKeys = await Promise.all(segments.map(({segmentId}) => {
      return getCacheKeys(
          viewId, segmentId.slice(6), optsHash, startDate, endDate);
    }));
  } catch (error) {
    handleDBError(error);
  }

  let usableKeys = [];
  const cachedDates = {};
  for (const key of foundKeys.flat()) {
    const date = key[3];
    cachedDates[date] = cachedDates[date] || [];
    cachedDates[date].push(key);

    // If there's a cache key for all needed segments, they are usable.
    if (cachedDates[date].length === segments.length) {
      usableKeys = usableKeys.concat(cachedDates[date]);
    }
  }

  let missingRanges = getMissingRanges(reportRequest, cachedDates);

  // If the average number of rows per day from the previous report for this
  // view is > 100,000 then just start off by requesting per-day data.
  const {avgRowsPerDay} = get(`meta:${viewId}`);
  if (avgRowsPerDay > 1e5) {
    let perDayMissingRanges = [];
    for (const {startDate, endDate} of missingRanges) {
      const datesInRange = getDatesInRange(startDate, endDate);
      perDayMissingRanges = perDayMissingRanges.concat(
          datesInRange.map((d) => ({startDate: d, endDate: d})));
    }
    missingRanges = perDayMissingRanges;
  }

  const [networkReport, cachedReport] = await Promise.all([
    getReportRowsByDatesFromAPI(reportRequest, missingRanges, controller),
    getCachedData(usableKeys),
  ]);

  const rows = mergeReportRows(cachedReport, networkReport);
  const source = sourcesNameMap[
      (missingRanges.length ? sources.NETWORK : 0) +
      (cachedReport.length ? sources.CACHE : 0)];

  // Don't await.
  updateCachedData(viewId, optsHash, networkReport).catch(handleDBError);

  return {rows, meta: {source}};
}

async function getCachedData(usableKeys) {
  // Start by populating the report with all available cached data
  // for the segments and dates specified.
  let cachedReport = [];
  let didError = false;

  try {
    progress.total += usableKeys.length;
    const db = await getDB();
    await Promise.all(usableKeys.map((key, i) => {
      return db.get('data', key).then((value) => {
        progress.cur++;
        if (!didError) {
          cachedReport = mergeReportRows(cachedReport, JSON.parse(value.json));
        }
      });
    }));
  } catch (error) {
    didError = true;
    throw new CacheReadError(error);
  }
  return cachedReport;
}

function getMissingRanges(reportRequest, cacheDates = {}) {
  const {startDate, endDate} = reportRequest.dateRanges[0];

  const missingRanges = [];
  let missingRangeStart;
  let missingRangeEnd;

  getDatesInRange(startDate, endDate).forEach((date, i, range) => {
    const missingDateData =
        cacheDates[date]?.length !== reportRequest.segments.length;

    if (missingDateData) {
      if (!missingRangeStart) {
        missingRangeStart = date;
      }
      missingRangeEnd = date;
    }

    if (!missingDateData || i === range.length - 1) {
      if (missingRangeStart && missingRangeEnd) {
        missingRanges.push({
          startDate: missingRangeStart,
          endDate: missingRangeEnd,
        });
        missingRangeStart = missingRangeEnd = null;
      }
    }
  });
  return missingRanges;
}

async function getReportRowsByDatesFromAPI(
    reportRequest, dateRanges, controller) {
  const rows = await Promise.all(
    dateRanges.map(async (dateRange) => {
      const newReportRequest =
          getReportRequestForDates(reportRequest, dateRange);

      return await getReportRowsFromAPI(newReportRequest, controller);
    }),
  );

  return rows.reduce((prev, next) => mergeReportRows(prev, next), []);
}

function getReportRequestForDates(reportRequest, dateRange) {
  const reportRequestClone = JSON.parse(JSON.stringify(reportRequest));
  reportRequestClone.dateRanges = [dateRange];

  return reportRequestClone;
}

function mergeReportRows(r1, r2) {
  // If either of the reportData objects are undefined, return the other.
  if (!(r1 && r2)) return r1 || r2;

  return mergeSortedArrays(r1, r2, (r) => Number(r.metrics[0].values[0]));
}
