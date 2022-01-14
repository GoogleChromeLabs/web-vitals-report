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

import {openDB} from 'idb';
import {getAccessToken} from './auth.js';
import {dateOffset, Deferred, getDatesInRange, hashObj, mergeSortedArrays, toISODate} from './utils.js';
import {WebVitalsError} from './WebVitalsError.js';


const MANAGEMENT_API_URL =
    'https://www.googleapis.com/analytics/v3/management/';

const REPORTING_API_URL =
    'https://analyticsreporting.googleapis.com/v4/reports:batchGet';


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

export function getReport(reportRequest, onProgress) {
  // Use the cache-aware API function if available, otherwise use the
  // standard API request function without caching.
  if (typeof getReportFromCacheAndAPI === 'function') {
    return getReportFromCacheAndAPI(reportRequest, onProgress);
  }
  return getReportFromAPI(reportRequest, onProgress);
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

export async function makeReportingAPIRequest(reportRequest) {
  try {
    incrementConcurrentRequests();
    await concurrentRequestsCountLessThanMax();

    const response = await fetch(REPORTING_API_URL, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        reportRequests: [reportRequest],
      }),
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(`${json.error.code}: ${json.error.message}`);
    }
    return json.reports[0];
  } finally {
    decrementConcurrentRequests();
  }
}

export async function getReportFromAPI(reportRequest, onProgress) {
  const rows = await getReportRowsFromAPI(reportRequest, onProgress);
  const source = sourcesNameMap[sources.NETWORK];
  return {rows, meta: {source}};
}

async function getReportRowsFromAPI(reportRequest, onProgress) {
  let totalRows;
  let report;
  let rows = [];

  const segmentDimensionIndex =
      reportRequest.dimensions.findIndex((dim) => dim.name === 'ga:segment');

  const {startDate, endDate} = reportRequest.dateRanges[0];

  // If the report request is a multi-date range containing yesterday or
  // today, split it up since this report data will likely not be "golden".
  const yesterday = dateOffset(-1);
  const today = dateOffset(0);
  if (endDate != startDate && startDate < yesterday && endDate >= yesterday) {
    let dateRanges = [
      {startDate: startDate, endDate: dateOffset(-2)},
      {startDate: yesterday, endDate: yesterday},
    ];
    // If the date range includes the current day, request that separately.
    if (endDate >= today) {
      dateRanges.push({startDate: today, endDate: endDate});
    }
    return await getReportRowsByDatesFromAPI(reportRequest, dateRanges);
  }

  do {
    report = await makeReportingAPIRequest(reportRequest);

    totalRows = report.data.rowCount;

    // Reports will be truncated after a million rows, so if this report
    // contains a million rows, try to break it up by requesting individual
    // dates.
    if (totalRows >= 1e6) {
      if (startDate !== endDate) {
        const dateRanges = getDatesInRange(startDate, endDate).map((date) => {
          return {startDate: date, endDate: date};
        });
        return await getReportRowsByDatesFromAPI(reportRequest, dateRanges);
      } else {
        throw new WebVitalsError('row_limit_exceeded');
      }
    }

    if (report.data.rows) {
      rows = rows.concat(report.data.rows);
    }

    if (onProgress) {
      const abort = await onProgress({rows, totalRows});
      if (abort) {
        return;
      }
    }

    if (report.nextPageToken) {
      // Clone the request before modifying it.
      reportRequest = JSON.parse(JSON.stringify(reportRequest));
      reportRequest.pageToken = report.nextPageToken;
    }
  } while (report.nextPageToken);

  const {samplesReadCounts, samplingSpaceSizes} = report.data;
  const sampleRate = samplesReadCounts && (samplesReadCounts[0] / samplingSpaceSizes[0]);

  for (const row of rows) {
    // If the data in the report is "golden", mark all rows as cacheable.
    if (report.data.isDataGolden) {
      cacheableRows.add(row);
    }

    // If the report contains sampled data, Google Analytics will automatically
    // adjust all metric values by the sample rate. In most cases, this is what
    // you want (e.g. if you're reporting total values), but since we're going
    // to be constructing a distribution from these values, we want to the
    // original values as sent.
    if (sampleRate) {
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


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
// NOTE: everything below this line deals with caching request data for
// faster subsequent requests, as well as breaking up large requests for
// better sampling rates and to avoid hitting the 1 million unique row limit.
// For sites that send less than a million Web Vitals events per month, this
// code is largely not necessary and can be deleted.
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *


const dbPromise = openDB('web-vitals-cache', 2, {
  async upgrade(db, oldVersion, newVersion, transaction) {
    if (oldVersion === 0) {
      db.createObjectStore('data', {
        keyPath: ['viewId', 'segmentId', 'optsHash', 'date'],
      });
    }
    if (oldVersion === 1) {
      // Due to a bug in v1, clear all data in the object store
      // because it could be incorrect in some cases.
      await transaction.objectStore('data').clear();
    }
  },
});

function getDB() {
  return dbPromise;
}

async function getCachedData(viewId, segmentId, optsHash, startDate, endDate) {
  const db = await getDB();
  const range = IDBKeyRange.bound(
    [viewId, segmentId, optsHash, startDate],
    [viewId, segmentId, optsHash, endDate],
  );
  const results = await db.getAll('data', range);

  const cachedData = {};
  for (const {date, json} of results) {
    cachedData[date] = JSON.parse(json);
  }
  return cachedData;
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

function getMissingRanges(reportRequest, cachedData) {
  const {startDate, endDate} = reportRequest.dateRanges[0];

  const missingRanges = [];
  let missingRangeStart;
  let missingRangeEnd;

  getDatesInRange(startDate, endDate).forEach((date, i, range) => {
    const missingDateData = !cachedData.every((s) => s[date]);

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

const sources = {
  CACHE: 1,
  NETWORK: 2,
  MIXED: 3,
};

const sourcesNameMap = Object.fromEntries(
    Object.entries(sources).map(([k, v]) => [v, k.toLowerCase()]));

async function getReportFromCacheAndAPI(reportRequest) {
  const {viewId, segments, dimensions, dimensionFilterClauses} = reportRequest;
  const {startDate, endDate} = reportRequest.dateRanges[0];
  const optsHash = await hashObj({dimensions, dimensionFilterClauses});

  // Start by populating the report with all available cached data
  // for the segments and dates specified.
  const cachedData = await Promise.all(segments.map(({segmentId}) => {
    return getCachedData(
        viewId, segmentId.slice(6), optsHash, startDate, endDate);
  }));

  let cachedReport = [];
  for (const segment of cachedData) {
    for (const rows of Object.values(segment)) {
      cachedReport = mergeReportRows(cachedReport, rows);
    }
  }

  const missingRangesFromCache = getMissingRanges(reportRequest, cachedData);

  const networkReport =
    await getReportRowsByDatesFromAPI(reportRequest, missingRangesFromCache);

  // Don't await.
  updateCachedData(viewId, optsHash, networkReport);

  const rows = mergeReportRows(cachedReport, networkReport);
  const source = sourcesNameMap[
      (missingRangesFromCache.length ? sources.NETWORK : 0) +
      (cachedReport.length ? sources.CACHE : 0)];

  return {rows, meta: {source}};
}

async function getReportRowsByDatesFromAPI(reportRequest, dateRanges) {
  const rows = await Promise.all(
    dateRanges.map(async (dateRange) => {
      const newReportRequest =
          getReportRequestForDates(reportRequest, dateRange);

      return await getReportRowsFromAPI(newReportRequest);
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
