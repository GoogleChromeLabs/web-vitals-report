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
  measurement_version: '1',
  transport_type: 'beacon',
  page_path: location.pathname,
  debug_mode: location.hostname !== 'web-vitals-report.web.app',
  custom_map: {
    dimension1: 'measurement_version',
    dimension2: 'client_id',
    dimension3: 'event_meta',
    dimension4: 'segments',
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

function sendToGoogleAnalytics({name, value, delta, id}) {
  gtag('event', name, {
    value: Math.round(name === 'CLS' ? delta * 1000 : delta),
    event_category: 'Web Vitals',
    event_label: id,
    event_meta: getRating(value, thresholds[name]),
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

export function measureReport(state) {
  gtag('event', 'report', {
    event_category: 'Usage',
    segments: [
      anonymizeSegment(state.segmentA),
      anonymizeSegment(state.segmentB),
    ].sort().join(', '),
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

