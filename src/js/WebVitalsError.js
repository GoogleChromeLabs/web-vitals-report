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

const errorMap = {
  'no_web_vitals_events': {
    title: 'No Web Vitals events found...',
    message: [
      'This report does not contain any Web Vitals event data. Make sure',
      'the account selected received Web Vitals events for the date range and',
      'and configuration options selected. You can learn how to measure and',
      'send Web Vitals data here: https://github.com/GoogleChrome/web-vitals',
    ].join(' '),
  },
  'row_limit_exceeded': {
    title: 'Sorry, cannot create report...',
    message: [
      'This account contains more than 1 million Web Vitals events per',
      'day, which is the maximum that can be reported on using the API.',
    ].join(' '),
  },
  'unsupported_filter_expression': {
    title: 'Unsupported filter expression...',
    message: [
      'OR based filter expressions (using a comma) are not supported.',
      'Only AND based filter expressions (using a semicolon) are allowed.',
    ].join(' '),
  },
  'invalid_filter_expression': {
    title: 'Invalid filter expression...',
    message: [
      'Filter expression "%s" is not valid. See:',
      'https://github.com/GoogleChromeLabs/web-vitals-report#filter-reference',
    ].join(' '),
  },
  'unexpected_metric': {
    title: 'Unexpected metric',
    message: 'The report contained a metric named "%s", which is not a valid.',
  },
};

export class WebVitalsError extends Error {
  constructor(code, ...params) {
    let {title, message} = errorMap[code];

    for (const param of params) {
      message = message.replace(/%s/, param);
    }

    super(message);
    this.title = title;
    this.code = code;
  }
}
