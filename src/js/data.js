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

import {getReport, getSegmentNameById, PAGE_SIZE} from './api.js';
import {WebVitalsError} from './WebVitalsError.js';


export async function getWebVitalsData(state, opts) {
  const reportRequest = buildReportRequest(state, opts);
  const {rows, meta} = await getReport(reportRequest);

  const metricNameMap = {
    [opts.lcpName]: 'LCP',
    [opts.fidName]: 'FID',
    [opts.clsName]: 'CLS',
  };

  if (rows.length === 0) {
    throw new WebVitalsError('no_web_vitals_events');
  }

  const getSegmentsObj = (getDefaultValue = () => []) => {
    const segmentIdA = reportRequest.segments[0].segmentId.slice(6);
    const segmentIdB = reportRequest.segments[1].segmentId.slice(6);
    let retValue = {
      [getSegmentNameById(segmentIdA)]: getDefaultValue(),
      [getSegmentNameById(segmentIdB)]: getDefaultValue(),
    }
    
    // As Segments C and D are optional they may not exist
    if (reportRequest.segments.length > 2) {
      const segmentIdC = reportRequest.segments[2].segmentId.slice(6);
      retValue[getSegmentNameById(segmentIdC)] = getDefaultValue()
    }
    if (reportRequest.segments.length > 3) {
      const segmentIdD = reportRequest.segments[3].segmentId.slice(6);
      retValue[getSegmentNameById(segmentIdD)] = getDefaultValue()
    }
    
    return retValue;
  };

  const getMetricsObj = (getDefaultValue = getSegmentsObj) => {
    return {
      LCP: getDefaultValue(),
      FID: getDefaultValue(),
      CLS: getDefaultValue(),
    };
  };

  const incrementCount = (obj) => {
    if (!Object.prototype.hasOwnProperty.call(obj, 'count')) {
      Object.defineProperty(obj, 'count', {writable: true, value: 0});
    }
    obj.count++;
  };

  const data = {
    metrics: getMetricsObj(() => {
      return {values: [], segments: getSegmentsObj(), dates: {}};
    }),
    countries: {},
    pages: {},
  };

  for (const row of rows) {
    let value = Number(row.metrics[0].values[0]);
    let [segmentId, date, metric, country, page] = row.dimensions;

    const debugId = opts.active && opts.debugDim ?
        row.dimensions[row.dimensions.length - 1] : null;

    const segment = getSegmentNameById(segmentId);

    // Convert the metric from any custom name to the standard name.
    metric = metricNameMap[metric];

    // CLS is sent to Google Analytics at 1000x for greater precision.
    if (metric === 'CLS') {
      value = value / 1000;
    }

    // Even though the report limits `metric` values to LCP, FID, and CLS,
    // for reports with more than a million rows of data, Google Analytics
    // will aggregate everything after the first million rows into and "(other)"
    // bucket, which skews the data and makes the report useless.
    // The only solution to this is to make more granular requests (e.g.
    // reduce the date range or add filters) and manually combine the data
    // yourself.
    if (metric !== 'LCP' && metric !== 'FID' && metric !== 'CLS') {
      throw new WebVitalsError('unexpected_metric', metric);
    }

    const metricData = data.metrics[metric];
    metricData.values.push(value);

    // Breakdown by segment.
    metricData.segments[segment] = metricData.segments[segment] || [];
    metricData.segments[segment].push(value);

    // Breakdown by date.
    metricData.dates[date] = metricData.dates[date] || getSegmentsObj();
    metricData.dates[date][segment].push(value);

    // Breakdown by country.
    data.countries[country] = data.countries[country] || getMetricsObj();
    data.countries[country][metric][segment].push(value);
    incrementCount(data.countries[country]);

    // Breakdown by page.
    data.pages[page] = data.pages[page] || getMetricsObj();
    const pageSeg = data.pages[page][metric][segment];
    pageSeg.push(value);
    incrementCount(data.pages[page]);

    // Debug info by page.
    if (debugId) {
      pageSeg.debug = pageSeg.debug || {};
      pageSeg.debug[debugId] = pageSeg.debug[debugId] || [];
      pageSeg.debug[debugId].push(value);
      incrementCount(pageSeg.debug[debugId]);
    }
  }

  // Sort data
  function sortObjByCount(obj) {
    const newObj = {};
    const sortedKeys =
        Object.keys(obj).sort((a, b) => obj[b].count - obj[a].count);

    for (const key of sortedKeys) {
      newObj[key] = obj[key];
    }
    return newObj;
  }

  // Sort data by count.
  data.countries = sortObjByCount(data.countries);
  data.pages = sortObjByCount(data.pages);

  return {data, rows, meta};
}

function parseFilters(filtersExpression) {
  if (filtersExpression.match(/[^\\],/)) {
    throw new WebVitalsError('unsupported_filter_expression');
  }

  // TODO: add support for escaping semicolons.
  return filtersExpression.split(';').map((expression) => {
    const match = /(ga:\w+)([!=][=@~])(.+)$/.exec(expression);
    if (!match) {
      throw new WebVitalsError('invalid_filter_expression', expression);
    }

    const filter = {
      dimensionName: match[1],
      expressions: [match[3]],
    };

    if (match[2].startsWith('!')) {
      filter.not = true;
    }

    if (match[2].endsWith('=')) {
      filter.operator = 'EXACT';
    } else if (match[2].endsWith('@')) {
      filter.operator = 'PARTIAL';
    } else if (match[3].endsWith('~')) {
      filter.operator = 'REGEXP';
    }
    return filter;
  });
}

function buildReportRequest(state, opts) {
  const {viewId, startDate, endDate, segmentA, segmentB, segmentC, segmentD} = state;

  const dimensions = [
    {name: 'ga:segment'},
    {name: 'ga:date'},
    {name: opts.metricNameDim}, // Metric name (ga:eventAction)
    {name: 'ga:country'},
    {name: 'ga:pagePath'},
    {name: opts.metricIdDim}, // Unique metric ID (ga:eventLabel)
  ];

  if (opts.active && opts.debugDim) {
    dimensions.push({name: opts.debugDim});
  }

  let filters = [
    {
      dimensionName: opts.metricNameDim,
      operator: 'IN_LIST',
      expressions: [opts.lcpName, opts.fidName, opts.clsName],
    },
  ];

  if (opts.active && opts.filters) {
    filters = filters.concat(parseFilters(opts.filters));
  }

  // We always have at least two segments
  let segments = [
    {segmentId: `gaid::${segmentA}`},
    {segmentId: `gaid::${segmentB}`},
  ];
  // And then optionally 1 or 2 more
  if (segmentC) {
    segments.push({segmentId: `gaid::${segmentC}`})
  }
  if (segmentD) {
    segments.push({segmentId: `gaid::${segmentD}`})
  }

  return {
    viewId,
    pageSize: PAGE_SIZE,
    // samplingLevel: 'SMALL',
    includeEmptyRows: true,
    dateRanges: [{startDate, endDate}],
    segments: segments,
    metrics: [{expression: 'ga:eventValue'}],
    dimensions,
    dimensionFilterClauses: {
      operator: 'AND',
      filters,
    },
    orderBys: [
      {
        fieldName: 'ga:eventValue',
        sortOrder: 'ASCENDING',
      },
      {
        fieldName: 'ga:date',
        sortOrder: 'ASCENDING',
      },
    ],
  };
}
