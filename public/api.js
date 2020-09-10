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

import {openDB} from 'https://unpkg.com/idb@5.0.4/build/esm/index.js?module';
import {getAccessToken} from './auth.js';
import {Deferred, getDatesInRange, mergeSortedArrays, toISODate} from './utils.js';


const MANAGEMENT_API_URL =
    'https://www.googleapis.com/analytics/v3/management/';

const REPORTING_API_URL =
    'https://analyticsreporting.googleapis.com/v4/reports:batchGet';


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

export function getReport(reportRequests, onProgress) {
  // Use the cache-aware API function if available, otherwise use the
  // standard API request function without caching.
  if (typeof getReportFromCacheAndAPI === 'function') {
    return getReportFromCacheAndAPI(reportRequests, onProgress);
  }
  return getReportFromAPI(reportRequests, onProgress);
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
  let totalRows;
  let report;
  let rows = [];

  const segmentDimensionIndex =
      reportRequest.dimensions.findIndex((dim) => dim.name === 'ga:segment');

  do {
    report = await makeReportingAPIRequest(reportRequest);

    totalRows = report.data.rowCount;

    // Reports will be truncated after a million rows, so if this report
    // contains a million rows, try to break it up by requesting individual
    // dates.
    if (totalRows >= 1e6) {
      const {startDate, endDate} = reportRequest.dateRanges[0];
      if (startDate !== endDate) {
        console.log('Too much data! Splitting up dates:', totalRows);

        const dateRanges = getDatesInRange(startDate, endDate).map((date) => {
          return {startDate: date, endDate: date};
        });
        return await getReportByDatesFromAPI(reportRequest, dateRanges);
      } else {
        console.log(
            'Report > 1e6 rows, even for a single day:', totalRows, startDate);
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

  // If the report contains sampled data, Google Analytics will automatically
  // adjust all metric values by the sample rate. In most cases, this is what
  // you want (e.g. if you're reporting total values), but since we're going
  // to be constructing a distribution from these values, we want to the
  // original values as sent.
  const {samplesReadCounts, samplingSpaceSizes} = report.data;
  if (samplesReadCounts) {
    const sampleRate = samplesReadCounts[0] / samplingSpaceSizes[0];
    for (const row of rows) {
      const value = row.metrics[0].values[0];
      row.metrics[0].values[0] = `${Math.round(value * sampleRate)}`;
    }
  }

  // The Reporting API will return the segment name, which is problematic
  // since we're going to be caching the data by segment, and users can change
  // the segment name in GA. Instead, use the segment ID.
  if (segmentDimensionIndex > -1) {
    for (const row of rows) {
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


const dbPromise = openDB('web-vitals-cache', 1, {
  upgrade(db) {
    db.createObjectStore('data', {
      keyPath: ['viewId', 'segmentId', 'date'],
    });
  },
});

function getDB() {
  return dbPromise;
}

async function getCachedData(viewId, segmentId, startDate, endDate) {
  const db = await getDB();
  const range = IDBKeyRange.bound(
    [viewId, segmentId, startDate],
    [viewId, segmentId, endDate],
  );
  const results = await db.getAll('data', range);

  const cachedData = {};
  for (const {date, json} of results) {
    cachedData[date] = JSON.parse(json);
  }
  return cachedData;
}

async function updateCachedData(reportRequest, rows) {
  const dateData = new Map();
  for (const row of rows) {
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
      await db.put('data', {
        viewId: reportRequest.viewId,
        segmentId,
        date: toISODate(date),
        json: JSON.stringify(rows),
      });
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

async function getReportFromCacheAndAPI(reportRequest) {
  const {viewId, segments} = reportRequest;
  const {startDate, endDate} = reportRequest.dateRanges[0];

  // Start by populating the report with all available cached data
  // for the segments and dates specified.
  const cachedData = await Promise.all(segments.map(({segmentId}) => {
    return getCachedData(viewId, segmentId.slice(6), startDate, endDate);
  }));

  let cachedReport = [];
  for (const segment of cachedData) {
    for (const rows of Object.values(segment)) {
      cachedReport = mergeReports(cachedReport, rows);
    }
  }

  const missingRangesFromCache = getMissingRanges(reportRequest, cachedData);
  console.log({missingRangesFromCache});

  const networkReport =
    await getReportByDatesFromAPI(reportRequest, missingRangesFromCache);

  // Don't await.
  updateCachedData(reportRequest, networkReport);

  return mergeReports(cachedReport, networkReport);
}


async function getReportByDatesFromAPI(reportRequest, dateRanges) {
  const reports = await Promise.all(
    dateRanges.map(async (dateRange) => {
      const newReportRequest =
          getReportRequestForDates(reportRequest, dateRange);

      return await getReportFromAPI(newReportRequest);
    }),
  );

  return reports.reduce((prev, next) => mergeReports(prev, next), []);
}

function getReportRequestForDates(reportRequest, dateRange) {
  const reportRequestClone = JSON.parse(JSON.stringify(reportRequest));
  reportRequestClone.dateRanges = [dateRange];

  return reportRequestClone;
}

function mergeReports(r1, r2) {
  // If either of the reportData objects are undefined, return the other.
  if (!(r1 && r2)) return r1 || r2;

  return mergeSortedArrays(r1, r2, (r) => Number(r.metrics[0].values[0]));
}


