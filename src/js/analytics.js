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

/* global gtag */

import {getCLS, getFCP, getFID, getLCP} from 'web-vitals';
import {getSegmentNameById} from './api.js';

const config = {
  measurement_version: '2',
  transport_type: 'beacon',
  page_path: location.pathname,
  debug_mode: location.hostname !== 'web-vitals-report.web.app',
  custom_map: {
    dimension1: 'measurement_version',
    dimension2: 'client_id',
    dimension3: 'segments',
    dimension4: 'config',
    dimension5: 'event_meta',
    dimension6: 'event_debug',
    metric1: 'report_size',
  },
};

const thresholds = {
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  FID: [100, 300],
  LCP: [2500, 4000],
};

function getRating(value, thresholds) {
  if (value > thresholds[1]) {
    return 'poor';
  }
  if (value > thresholds[0]) {
    return 'ni';
  }
  return 'good';
}

function getElementPath(el, containers) {
  try {
    let name = el.nodeName.toLowerCase();
    if (name === 'body') {
      return 'html>body';
    }
    if (el.id) {
      return `${name}#${el.id}`;
    }
    if (el.className.length) {
      name += `.${[...el.classList.values()].join('.')}`;
    }
    return `${getElementPath(el.parentElement)}>${name}`;
  } catch (error) {
    return '(error)';
  }
}

function getDebugInfo(name, entries = []) {
  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];

  switch (name) {
    case 'LCP':
      if (lastEntry) {
        return getElementPath(lastEntry.element);
      }
    case 'FID':
      if (firstEntry) {
        const {name} = firstEntry;
        // Report interactions with the `google-signin2` element as that,
        // not any of the sub-elements.
        console.log(name);
        if (firstEntry.target.closest('#google-signin2')) {
          return `${name}:#google-signin2`;
        }
        return `${name}:${getElementPath(firstEntry.target)}`;
      }
    case 'CLS':
      if (entries.length) {
        const largestShift = entries.reduce((a, b) => {
          return a && a.value > b.value ? a : b;
        });
        if (largestShift && largestShift.sources) {
          const largestSource = largestShift.sources.reduce((a, b) => {
            return a.node && a.previousRect.width * a.previousRect.height >
                b.previousRect.width * b.previousRect.height ? a : b;
          });
          if (largestSource) {
            return getElementPath(largestSource.node);
          }
        }
      }
    default:
      return '(not set)';
  }
}

function sendToGoogleAnalytics({name, value, delta, id, entries}) {
  gtag('event', name, {
    value: Math.round(name === 'CLS' ? delta * 1000 : delta),
    event_category: 'Web Vitals',
    event_label: id,
    event_meta: getRating(value, thresholds[name]),
    event_debug: getDebugInfo(name, entries),
    non_interaction: true,
  });
}

export function measureWebVitals() {
  getCLS(sendToGoogleAnalytics);
  getFCP(sendToGoogleAnalytics);
  getFID(sendToGoogleAnalytics);
  getLCP(sendToGoogleAnalytics);
}

function anonymizeSegment(id) {
  if (id.match(/^-\d+$/)) {
    return getSegmentNameById(id);
  } else {
    return 'Custom Segment';
  }
}

function anonymizeConfig(state) {
  const opts = state[`opts:${state.viewId}`];
  if (opts && opts.active) {
    return [
      `id=${opts.metricIdDim}`,
      `name=${opts.metricNameDim}`,
      `metrics=${[opts.lcpName, opts.fidName, opts.clsName].join(',')}`,
      `filters=${opts.filters}`,
    ].join('|');
  }
  return '(not set)';
}

export function measureReport({state, duration, report, error}) {
  gtag('event', `report-${error ? 'error' : 'success'}`, {
    value: duration,
    report_size: report ? report.rows.length : 0,
    segments: [
      anonymizeSegment(state.segmentA),
      anonymizeSegment(state.segmentB),
    ].sort().join(', '),
    config: anonymizeConfig(state),
    event_category: 'Usage',
    event_label: error ? (error.code || error.message) : '(not set)',
    event_meta: report ? report.meta.source : '(not set)',
  });
}

export function initAnalytics() {
  if (location.hostname !== 'web-vitals-report.web.app') {
    window.gtag = console.log;
  }

  gtag('js', new Date());
  gtag('config', 'G-P1J6CQWJ4R', config);
  gtag('config', 'UA-185052243-1', config);

  measureWebVitals();
}
