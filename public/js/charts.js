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

/* global Highcharts */

import {e} from './utils.js';


const COLORS = ['#aaa', '#2b79fe'];

function bucketValues(arrayOfValues, {maxValue, bucketSize = 10} = {}) {
  maxValue = maxValue || arrayOfValues[arrayOfValues.length - 1];

  const bucketMap = {};
  for (const value of arrayOfValues) {
    if (value > maxValue) break;

    const bucket = Math.floor(value / bucketSize) * bucketSize;
    if (!bucketMap[bucket]) {
      bucketMap[bucket] = 0;
    }
    ++bucketMap[bucket];
  }

  const bucketEntries = [];
  for (let bucket = 0; bucket < maxValue; bucket += bucketSize) {
    bucketEntries.push([String(bucket), bucketMap[bucket] || 0]);
  }

  return bucketEntries;
}

function drawHistogram({
  container,
  metric,
  dimensionValues,
  bucketSize = 20,
  maxValue = 1000,
} = {}) {
  // The `allBuckets` object is used to create the x-axis.
  const allBuckets = [];
  for (let bucket = 0; bucket < maxValue; bucket += bucketSize) {
    // Avoid floating point rounding errors.
    bucket = Math.round(bucket * 100) / 100;
    allBuckets.push(bucket);
  }

  const dimensionBuckets = {};
  for (const [dimension, values] of Object.entries(dimensionValues)) {
    dimensionBuckets[dimension] = bucketValues(values, {maxValue, bucketSize});
  }

  // Sort the dimensions to ensure series order is deterministic (otherwise
  // the colors applied to each series could change based on the data passed).
  const series = Object.keys(dimensionBuckets).map((key) => {
    return {
      type: 'column',
      name: key,
      data: dimensionBuckets[key],
    };
  });

  Highcharts.chart(container, {
    title: {text: `${metric} distribution`},
    colors: COLORS,
    xAxis: [{
      title: {text: 'Time (ms)'},
      categories: allBuckets,
      lineColor: '#9e9e9e',
    }],
    yAxis: [{
      title: {text: 'Count'},
    }],
    plotOptions: {
      column: {
        grouping: false,
        pointPadding: 0,
        groupPadding: 0,
        pointPlacement: 'between',
        opacity: 0.8,
      },
    },
    series,
  });
}

function drawTimeline(name, dateValues) {
  const seriesObj = {};

  for (const [date, values] of Object.entries(dateValues)) {
    const timestamp = Date.UTC(
        date.slice(0, 4), date.slice(4, 6) - 1, date.slice(6));

    for (const segmentName of Object.keys(values)) {
      seriesObj[segmentName] =
          seriesObj[segmentName] || {name: segmentName, data: []};

      const segmentValues = values[segmentName];
      if (segmentValues.length > 8) {
        seriesObj[segmentName].data = seriesObj[segmentName].data || [];
        seriesObj[segmentName].data.push([timestamp, p(75, segmentValues)]);
      }
    }
  }

  Highcharts.chart(`timeline-${name}`, {
    chart: {type: 'spline'},
    colors: COLORS,
    title: {text: `${name} over time (p75)`},
    xAxis: {type: 'datetime'},
    yAxis: {min: 0},
    series: [...Object.values(seriesObj)],
  });
}

function drawSummary(metric, segments) {
  const $el = document.getElementById(`summary-${metric}`);
  let html = ``;

  for (const [name, values] of Object.entries(segments)) {
    const result = p75(values);

    html += `
    <span class="Report-metricSummaryItem">
      ${e(name)}
      <span class="Score Score--alt Score--${score(metric, result)}">${
        result
      }</span>
    </span>
  `;
  }

  $el.innerHTML = html;
}

function drawTable(id, dimensionName, dimensionData) {
  const metricNames = Object.keys(dimensionData[0][1]);
  const segmentNames = Object.keys(dimensionData[0][1][metricNames[0]]);

  document.getElementById(id).innerHTML = `
    <thead>
      <tr>
        <th class="Table-dimension">${e(dimensionName)}</th>
        <th class="Table-segment">Segment</th>
        ${metricNames.map((metric) => {
          return `<th class="Table-metric">${e(metric)}</th>`;
        }).join('')}
      </tr>
    </thead>
    <tbody>
      ${dimensionData.slice(0, 5).map(([dimension, values]) => {
        return segmentNames.map((segment, i) => `<tr>
          ${i === 0
            ? `<td class="Table-dimension" rowspan="2">${e(dimension)}</td>`
            : ''}
          <td class="Table-segment">${e(segment)}</td>
          ${metricNames.map((metric) => {
            const result = p75(values[metric][segment]);
            return `
              <td>
                <div class="Score Score--${score(metric, result)}">
                  ${result}
                </div>
              </td>
            `;
          }).join('')}
        </tr>`).join('');
      }).join('')}
    </tbody>
  `;
}

function score(metric, p75) {
  const thresholds = {
    LCP: [2500, 4000],
    FID: [100, 300],
    CLS: [0.1, 0.25],
    // LCP: [1100, 2000],
    // FID: [4, 10],
    // CLS: [0.1, 0.25],
  };
  if (p75 <= thresholds[metric][0]) {
    return 'good';
  }
  if (p75 <= thresholds[metric][1]) {
    return 'ni';
  }
  if (p75 > thresholds[metric][1]) {
    return 'poor';
  }
  return 'unknown';
}

function p(percentile, values) {
  return values[Math.floor((values.length) * (percentile / 100))];
}

function p75(values) {
  if (values && values.length > 8) {
    return p(75, values);
  }
  return '-'; // Insufficient data
}

export function renderCharts(data) {
  for (const [name, metric] of Object.entries(data.metrics)) {
    let maxValue;
    let bucketSize;

    // Calculate high-percentile values to determine the histogram dimensions.
    const p95 = p(95, metric.values);
    const p98 = p(98, metric.values);

    switch (name) {
      case 'LCP':
        maxValue = Math.max(Math.ceil(p98 / 1000) * 1000, 3000);

        bucketSize = 100;
        if (maxValue > 5000) {
          bucketSize = 200;
        }
        if (maxValue > 10000) {
          bucketSize = 500;
        }
        break;
      case 'FID':
        maxValue = Math.max(Math.ceil(p95 / 50) * 50, 50);
        bucketSize = 1;
        if (maxValue > 100) {
          bucketSize = 2;
        }
        if (maxValue > 300) {
          bucketSize = 5;
        }
        if (maxValue > 1000) {
          bucketSize = 10;
        }
        break;
      case 'CLS':
        maxValue = Math.max(Math.ceil(p95 * 10) / 10, 0.1);
        bucketSize = 0.01;
        if (maxValue > 0.3) {
          bucketSize = 0.05;
        }
        if (maxValue > 1) {
          bucketSize = 0.1;
        }
        break;
    }

    drawSummary(name, metric.segments);

    drawHistogram({
      metric: name,
      container: `histogram-${name}`,
      maxValue: maxValue,
      bucketSize: bucketSize,
      dimensionValues: metric.segments,
    });

    drawTimeline(name, metric.dates);

    document.getElementById('report').hidden = false;
  }

  drawTable('countries', 'Country', [...Object.entries(data.countries)]);
  drawTable('pages', 'Page', [...Object.entries(data.pages)]);
}
