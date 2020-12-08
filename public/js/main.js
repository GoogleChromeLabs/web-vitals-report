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

import {html, render} from 'https://unpkg.com/lit-html?module';
import {addAlert} from './alerts.js';
import {getAccountSummaries, getSegments} from './api.js';
import {checkAuthStatus, getAuthInstance, onSignInChange, userIsSignedIn} from './auth.js';
import {renderCharts} from './charts.js';
import {getWebVitalsData} from './data.js';
import {initState, getState, setState, addChangeListener} from './state.js';
import {dateOffset, nextFrame, timeout} from './utils.js';


const windowLoaded = new Promise((resolve) => {
  addEventListener('load', resolve);
});

const data = {
  dateRangeOpts: [
    ['7', 'Last 7 days'],
    ['14', 'Last 14 days'],
    ['28', 'Last 28 days'],
    ['-1', 'Custom range'],
  ],
  segmentsRecommendedOpts: [
    ['-15,-14', 'Desktop Traffic vs Mobile Traffic'],
    ['-2,-3', 'New Users vs. Returning Users'],
    ['-19,-12', 'Bounced Sessions vs. Non-bounce Sessions'],
    ['-102,-103', 'Converters vs. Non-converters'],
    ['', 'Choose segments'],
  ],
};

async function initViewOpts() {
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
  data.viewOpts = viewOpts;
  queueRender();
}

async function initSegmentOpts() {
  const segmentOpts = {
    'BUILT_IN': [],
    'CUSTOM': [],
  };
  const segments = await getSegments();
  for (const {type, name, id} of segments) {
    segmentOpts[type].push([id, name]);
  }

  data.segmentOpts = segmentOpts;
  queueRender();
}

function onDateRangeChange(newValue) {
  if (newValue > 0) {
    setState({
      startDate: dateOffset(-newValue),
      endDate: dateOffset(-1),
    });
  }
}

function onSegmentsRecommendedChange(newValue) {
  if (newValue) {
    const [segmentA, segmentB] = newValue.split(',');
    setState({segmentA, segmentB});
  }
}

function onIsFetchingDataChange(newValue) {
  if (newValue === true) {
    document.body.classList.add('isFetchingData');
  } else {
    document.body.classList.remove('isFetchingData');
  }
}

function onChange({target}) {
  setState({[target.id]: target.value});
  queueRender();
}

async function onSubmit(event) {
  event.preventDefault();

  // Account for cases where the user kept the tab open for more than
  // a day, so the start/end dates need to be updated.
  const {dateRange} = getState();
  if (dateRange > 0) {
    onDateRangeChange(dateRange);
  }

  try {
    setState({isFetchingData: true});

    // Ensure the Highcharts library (loaded async) is ready.
    await windowLoaded;

    const [data] = await Promise.all([
      getWebVitalsData(getState()),
      // Make the request at least 1 second long. If the request completes too
      // quickly it's not always obvious something happened.
      timeout(1000),
    ]);
    renderCharts(data);
  } catch (error) {
    addAlert({
      title: 'Oops, something went wrong!',
      body: error.message,
    });
  } finally {
    setState({isFetchingData: false});
  }
}

function renderOpts(selected, options) {
  return options.map(([value, name]) => html`
    <option ?selected=${selected === value} value=${value}>${name}</option>
  `);
}

const app = (state, data) => {
  const showCustomDateRangeSelect = state.dateRange < 0;
  const showCustomSegmentsSelect =
      !state.segmentsRecommended && data.segmentOpts;

  return html`
    <form class="Form" @submit=${onSubmit}>
      <div class="Form-field">
        <label>1. Select a Google Analytics account</label>
        <select id="viewId" @input=${onChange}>
          ${data.viewOpts && Object.keys(data.viewOpts).map((accountName) => {
            return html`<optgroup label=${accountName}>${
              data.viewOpts[accountName].map(({id, name}) => {
                return html`
                  <option ?selected=${state.viewId === id} value=${id}>
                    ${name}
                  </option>
                `;
              })
            }</optgroup>`;
          })}
        </select>
      </div>
      <div class="Form-field">
        <label>2. Choose a date range</label>
        <select id="dateRange" @input=${onChange}>
          ${renderOpts(state.dateRange, data.dateRangeOpts)}
        </select>
        ${showCustomDateRangeSelect ? html`
          <div class="Form-subfield">
            <div class="Form-field">
              <label>Start date</label>
              <input id="startDate" @input=${onChange} type="date" />
            </div>
            <div class="Form-field">
              <label>End date</label>
              <input id="endDate" @input=${onChange} type="date" />
            </div>
          </div>` :
        null}
      </div>
      <div class="Form-field">
        <label>3. Compare segments</label>
        <select id="segmentsRecommended" @input=${onChange}>
          ${renderOpts(state.segmentsRecommended, data.segmentsRecommendedOpts)}
        </select>
        ${showCustomSegmentsSelect ? html`
          <div class="Form-subfield">
            <div class="Form-field">
              <label>First segment</label>
              <select id="segmentA" @input=${onChange}>
                <optgroup label="Built-in Segments">
                  ${renderOpts(state.segmentA, data.segmentOpts.BUILT_IN)}
                </optgroup>
                <optgroup label="Custom Segments">
                  ${renderOpts(state.segmentA, data.segmentOpts.CUSTOM)}
                </optgroup>
              </select>
            </div>
            <div class="Form-field">
              <label>Second segment</label>
              <select id="segmentB" @input=${onChange}>
                <optgroup label="Built-in Segments">
                  ${renderOpts(state.segmentB, data.segmentOpts.BUILT_IN)}
                </optgroup>
                <optgroup label="Custom Segments">
                  ${renderOpts(state.segmentB, data.segmentOpts.CUSTOM)}
                </optgroup>
              </select>
            </div>
          </div>
        ` : null}
      </div>
      <div class="Form-action">
        <button class="Button" .disabled=${state.isFetchingData}>
          ${state.isFetchingData ? 'Loading...' : 'Submit'}
        </button>
      </di>
    </form>
  `;
};

function renderApp() {
  render(app(getState(), data), document.getElementById('app'));
}

let isRenderPending = false;
function queueRender() {
  if (!isRenderPending) {
    requestAnimationFrame(() => {
      renderApp();
      isRenderPending = false;
    });
    isRenderPending = true;
  }
}

function handleSignInChange(isSignedIn) {
  const signInToggle = document.getElementById('signin-toggle');
  const toggle = isSignedIn ? 'Out' : 'In';
  const classes = ['isSignedIn', 'isSignedOut'];
  if (!isSignedIn) {
    classes.reverse();
    document.getElementById('report').hidden = true;
  }

  signInToggle.textContent = `Sign ${toggle}`;
  document.body.classList.add(classes[0]);
  document.body.classList.remove(classes[1]);

  signInToggle.onclick = () => {
    getAuthInstance()[`sign${toggle}`]();
  };
}

async function init() {
  const isSignedIn = await checkAuthStatus();
  handleSignInChange(isSignedIn);

  initState((storedState) => {
    const defaultState = {
      dateRange: 7,
      segmentsRecommended: '-15,-14',
    };
    const loadState = {
      isFetchingData: false,
      isSignedIn,
    };
    return Object.assign(defaultState, storedState, loadState);
  });

  addChangeListener('dateRange', onDateRangeChange);
  addChangeListener('segmentsRecommended', onSegmentsRecommendedChange);
  addChangeListener('isFetchingData', onIsFetchingDataChange);
  addChangeListener('*', queueRender);
  onSignInChange(handleSignInChange);
  renderApp();

  await nextFrame();
  document.body.classList.add('isReady');

  await userIsSignedIn();
  await Promise.all([
    initViewOpts(),
    initSegmentOpts(),
  ]);
}

// Initialize the page.
init();
