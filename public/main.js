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

import {getAccountSummaries, getSegments} from './api.js';
import {setAuthorizedUser} from './auth.js';
import {renderCharts} from './charts.js';
import {getWebVitalsData} from './data.js';
import {initState, getState, setState, addChangeListener} from './state.js';
import {$, e, dateOffset} from './utils.js';

const windowLoaded = new Promise((resolve) => {
  addEventListener('load', resolve);
});

const signedIn = new Promise((resolve) => {
  // Expose the `onSignIn` callback to the `g-signin2` component.
  self.onSignIn = (googleUser) => {
    setAuthorizedUser(googleUser);
    resolve(googleUser);
  };
});


function bindStateKeyToInput(stateKey, $element) {
  // Set the initial value and listen for changes.
  $element.value = getState()[stateKey];
  $element.addEventListener('input', () => {
    setState({[stateKey]: $element.value});
  });
  addChangeListener(stateKey, (newValue) => {
    $element.value = newValue;
  });
}

async function initViewSelect() {
  let {viewId} = getState();
  const viewOpts = {};
  const accountSummaries = await getAccountSummaries();

  for (const {name: accountName, webProperties} of accountSummaries) {
    if (webProperties) {
      for (const {name: propertyName, profiles} of webProperties) {
        if (profiles) {
          for (const {name: viewName, id} of profiles) {
            // If no view has been saved from a previous session,
            // the first view listed will be used.
            if (!viewId) {
              viewId = id;
              setState({viewId});
            }

            viewOpts[accountName] = viewOpts[accountName] || [];
            viewOpts[accountName].push({
              name: `${propertyName} (${viewName})`,
              id: id,
            });
          }
        }
      }
    }
  }

  const $viewId = $('view-id');
  $viewId.disabled = false;
  $viewId.innerHTML = Object.keys(viewOpts).map((accountName) => {
    return `<optgroup label="${e(accountName)}">${
      viewOpts[accountName].map(({id, name}) => {
        return `<option value="${e(id)}">${e(name)}</option>`;
      }).join('')
    }</optgroup>`;
  }).join('');

  bindStateKeyToInput('viewId', $viewId);
}

async function initSegmentSelect() {
  const handleSegmentsRecommendedChange = (newValue) => {
    $('segment-picker-custom').hidden = Boolean(newValue);
    if (newValue) {
      const [segmentA, segmentB] = newValue.split(',');
      setState({segmentA, segmentB});
    }
  };

  bindStateKeyToInput('segmentsRecommended', $('segmentsRecommended'));
  addChangeListener('segmentsRecommended', handleSegmentsRecommendedChange);

  // Apply initial state.
  handleSegmentsRecommendedChange(getState().segmentsRecommended);
}

async function initSegmentSelectOptions() {
  const segmentOpts = {
    'BUILT_IN': [],
    'CUSTOM': [],
  };
  const segments = await getSegments();
  for (const {type, name, id} of segments) {
    segmentOpts[type].push({name, id});
  }

  const buildSegmentsSelectOptions = (elementId, stateKey = elementId) => {
    const $el = $(elementId);
    $el.disabled = false;
    $el.innerHTML = `
      <optgroup label="Built-in Segments">${
        segmentOpts.BUILT_IN.map(({id, name}) => {
          return `<option value="${id}">${e(name)}</option>`;
        }).join('')
      }</optgroup>
      <optgroup label="Custom Segments">${
        segmentOpts.CUSTOM.map(({id, name}) => {
          return `<option value="${id}"}>${e(name)}</option>`;
        }).join('')
      }</optgroup>
    `;
    bindStateKeyToInput(stateKey, $el);
  };

  buildSegmentsSelectOptions('segmentA');
  buildSegmentsSelectOptions('segmentB');
}

function handleDateRangeChange(newValue) {
  $('date-range-picker').hidden = newValue > 0; // Custom range is -1.
  if (newValue > 0) {
    setState({
      startDate: dateOffset(-newValue),
      endDate: dateOffset(-1),
    });
  }
}

function initDateSelect() {
  const $dateRange = $('date-range');
  $dateRange.disabled = false;
  bindStateKeyToInput('dateRange', $dateRange);
  addChangeListener('dateRange', handleDateRangeChange);

  const $startDate = $('start-date');
  $startDate.setAttribute('min', dateOffset(-28));
  bindStateKeyToInput('startDate', $startDate);

  const $endDate = $('end-date');
  $endDate.setAttribute('value', getState().endDate);
  bindStateKeyToInput('endDate', $endDate);

  // Apply initial state.
  handleDateRangeChange(getState().dateRange);
}

function initForm() {
  const $submit = $('submit');
  $submit.disabled = true; // Assumed signed out until sign-in state is known.
  addChangeListener('isFetchingData', (newValue) => {
    if (newValue === true) {
      $submit.disabled = true;
      $submit.textContent = 'Loading...';
    } else {
      $submit.disabled = false;
      $submit.textContent = 'Submit';
    }
  });

  addChangeListener('isSignedIn', (newValue) => {
    $submit.disabled = !newValue;
  });

  const $form = $('config');
  $form.addEventListener('submit', async (event) => {
    event.preventDefault();

    // Account for cases where the user kept the tab open for more than
    // a day, so the start/end dates need to be updated.
    const {dateRange} = getState();
    if (dateRange > 0) {
      handleDateRangeChange(dateRange);
    }

    setState({isFetchingData: true});
    const data = await getWebVitalsData(getState());
    setState({isFetchingData: false});

    renderCharts(data);
  });
}


async function init() {
  initState((storedState) => {
    const defaultState = {
      dateRange: 7,
      segmentsRecommended: '-15,-14',
    };
    // Merge stored state with default state, but don't set signed-in state
    // until status is confirmed by the `g-signin2` component.
    return Object.assign({}, defaultState, storedState, {isSignedIn: false});
  });

  initDateSelect();
  initSegmentSelect();
  initForm();

  document.body.classList.add('ready');

  await signedIn;
  setState({isSignedIn: true});

  // Wait until the user is signed and the window is loaded before
  // initializing components that require API calls.
  // This also allows HighCharts to load async.
  await windowLoaded,
  await Promise.all([
    initViewSelect(),
    initSegmentSelectOptions(),
  ]);
}

// Initialize the page.
init();
