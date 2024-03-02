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

import {html, render} from 'lit-html';
import {addAlert} from './js/alerts.js';
import {initAnalytics, measureReport} from './js/analytics.js';
import {getAccountSummaries, getSegments} from './js/api.js';
import {checkAuthStatus, initAuthClient, signoutAccessToken, getAccessToken, refreshAccessToken} from './js/auth.js';
import {renderCharts} from './js/charts.js';
import {getWebVitalsData} from './js/data.js';
import {progress} from './js/Progress.js';
import {initState, getState, setState, addChangeListener} from './js/state.js';
import {set} from './js/store.js';
import {dateOffset, getDatesInRange, nextFrame, round, timeout} from './js/utils.js';


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

function validateOpts(opts = {}) {
  return {
    active: false,
    metricNameDim: 'ga:eventAction',
    metricIdDim: 'ga:eventLabel',
    category: 'Web Vitals',
    lcpName: 'LCP',
    fidName: 'FID',
    clsName: 'CLS',
    inpName: 'INP',
    filters: '',
    debugDim: '',
    ...opts,
  };
}

async function initViewOpts() {
  let {viewId} = getState();
  const viewOpts = {};
  const accountSummaries = await getAccountSummaries();

  if (!accountSummaries || !accountSummaries[0]) {
    // Getting accounts failed, so must have become signed out.
    // e.g. if access_token is expired.
    signoutAccessToken();
    toggleButton(false);
    return;
  }
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

  if (!segments || !segments[0]) {
    return;
  }

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
    const [segmentA, segmentB, segmentC, segmentD] = newValue.split(',');
    setState({segmentA, segmentB, segmentC, segmentD});
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
  if (target.id.startsWith('opts:')) {
    const field = target.id.slice(5); // After the colon.
    const state = getState();
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const key = `opts:${state.viewId}`;
    const opts = validateOpts(state[key]);
    opts[field] = value;
    setState({[key]: opts});
  } else {
    setState({[target.id]: target.value});
  }
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

  const reportState = getState();
  const viewOpts = reportState[`opts:${reportState.viewId}`];
  const reportOpts = validateOpts(viewOpts && viewOpts.active ? viewOpts : {});
  const startTime = performance.now();

  let report;
  let error;

  try {
    setState({isFetchingData: true, progress: ''});
    progress.init(() => setState({progress: `(${progress.percentage}%)`}));

    // Ensure the Highcharts library (loaded async) is ready.
    await windowLoaded;

    const results = await Promise.all([
      getWebVitalsData(reportState, reportOpts),
      // Make the request at least 300ms long so the animation can complete.
      // If the animation ends too quickly it's not obvious anything happened.
      timeout(300),
    ]);
    report = results[0];
    renderCharts(report, reportOpts);
  } catch (requestError) {
    console.error(requestError);
    addAlert(requestError);
    error = requestError;
  } finally {
    setState({isFetchingData: false});
    measureReport({
      state: getState(),
      duration: Math.round(performance.now() - startTime),
      report,
      error,
    });

    // Persist the average number of rows per day in the report. This is
    // used to determine whether subsequent reports should start off being
    // broken up by day.
    const {startDate, endDate, viewId} = reportState;
    const avgRowsPerDay = round(
        report.rows.length / getDatesInRange(startDate, endDate).length, 0);

    set(`meta:${viewId}`, {avgRowsPerDay});
  }
}

function renderOpts(selected, options) {
  return options.map(([value, name]) => html`
    <option ?selected=${selected === value} .value=${value}>${name}</option>
  `);
}

const app = (state, data) => {
  const opts = validateOpts(state[`opts:${state.viewId}`]);
  const showCustomDateRangeSelect = state.dateRange < 0;
  const showCustomSegmentsSelect = !state.segmentsRecommended;

  return html`
    <form class="Form" @input=${onChange} @submit=${onSubmit}>
      <div class="Form-field">
        <label>1. Select a Google Analytics account</label>
        <select id="viewId">
          ${data.viewOpts && Object.keys(data.viewOpts).map((accountName) => {
            return html`<optgroup label=${accountName}>${
              data.viewOpts[accountName].map(({id, name}) => {
                return html`
                  <option ?selected=${state.viewId === id} .value=${id}>
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
        <select id="dateRange">
          ${renderOpts(state.dateRange, data.dateRangeOpts)}
        </select>
        ${showCustomDateRangeSelect ? html`
          <div class="Form-subfield">
            <div class="Form-field">
              <label>Start date</label>
              <input id="startDate" type="date" .value=${state.startDate} />
            </div>
            <div class="Form-field">
              <label>End date</label>
              <input id="endDate" type="date" .value=${state.endDate} />
            </div>
          </div>` :
        null}
      </div>
      <div class="Form-field">
        <label>3. Compare segments</label>
        <select id="segmentsRecommended">
          ${renderOpts(state.segmentsRecommended, data.segmentsRecommendedOpts)}
        </select>
        ${showCustomSegmentsSelect ? html`
          <div class="Form-subfield">
            <div class="Form-field">
              <label>First segment</label>
              <select id="segmentA">
               ${data.segmentOpts ? html`
                <optgroup label="Built-in Segments">
                  ${renderOpts(state.segmentA, data.segmentOpts.BUILT_IN)}
                </optgroup>
                <optgroup label="Custom Segments">
                  ${renderOpts(state.segmentA, data.segmentOpts.CUSTOM)}
                </optgroup>
               ` : null}
              </select>
            </div>
            <div class="Form-field">
              <label>Second segment</label>
              <select id="segmentB">
                ${data.segmentOpts ? html`
                  <optgroup label="Built-in Segments">
                    ${renderOpts(state.segmentB, data.segmentOpts.BUILT_IN)}
                  </optgroup>
                  <optgroup label="Custom Segments">
                    ${renderOpts(state.segmentB, data.segmentOpts.CUSTOM)}
                  </optgroup>
                ` : null}
              </select>
            </div>
            <div class="Form-field">
              <label>Third segment (optional)</label>
              <select id="segmentC">
                <option value="">None</option>
                ${data.segmentOpts ? html`
                  <optgroup label="Built-in Segments">
                    ${renderOpts(state.segmentC, data.segmentOpts.BUILT_IN)}
                  </optgroup>
                  <optgroup label="Custom Segments">
                    ${renderOpts(state.segmentC, data.segmentOpts.CUSTOM)}
                  </optgroup>
                ` : null}
              </select>
            </div>
            <div class="Form-field">
              <label>Fourth segment (optional)</label>
              <select id="segmentD">
                <option value="">None</option>
                ${data.segmentOpts ? html`
                  <optgroup label="Built-in Segments">
                    ${renderOpts(state.segmentD, data.segmentOpts.BUILT_IN)}
                  </optgroup>
                  <optgroup label="Custom Segments">
                    ${renderOpts(state.segmentD, data.segmentOpts.CUSTOM)}
                  </optgroup>
                ` : null}
              </select>
            </div>
          </div>
        ` : null}
      </div>

      <div class="Form-field">
        <label class="Form-advancedAction">
          <input type="checkbox" id="opts:active" .checked=${opts.active}>
          Use advanced options (configurable per account)
        </label>
        ${opts.active ? html`
          <div class="Form-advancedFields">
            <div class="Form-field">
              <label>Metric ID dimension</label>
              <input id="opts:metricIdDim" type="text"
                     .value=${opts.metricIdDim}>
            </div>
            <div class="Form-field">
              <label>Metric name dimension</label>
              <input id="opts:metricNameDim" type="text"
                     .value=${opts.metricNameDim}>
            </div>
            <div class="Form-3col">
              <div class="Form-field">
                <label>LCP name</label>
                <input id="opts:lcpName" type="text"
                       .value=${opts.lcpName}>
              </div>
              <div class="Form-field">
                <label>FID name</label>
                <input id="opts:fidName" type="text"
                       .value=${opts.fidName}>
              </div>
              <div class="Form-field">
                <label>CLS name</label>
                <input id="opts:clsName" type="text"
                       .value=${opts.clsName}>
              </div>
              <div class="Form-field">
                <label>INP name</label>
                <input id="opts:inpName" type="text"
                       .value=${opts.inpName}>
              </div>
            </div>
            <div class="Form-field">
              <label>Debug dimension <em>(optional)</em></label>
              <input id="opts:debugDim" type="text"
                    .value=${opts.debugDim}>
            </div>
            <div class="Form-field">
              <label>Additional filters <em>(optional)</em></label>
              <input id="opts:filters" type="text"
                     .value=${opts.filters}>
            </div>
          </div>`
        : null}
      </div>

      <div class="Form-action">
        <button class="Button" .disabled=${state.isFetchingData}>
          ${state.isFetchingData ? `Loading... ${state.progress}` : 'Submit'}
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

function toggleButton(isSignedIn) {
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
}

function handleSignInChange(isSignedIn) {
  const signInToggle = document.getElementById('signin-toggle');
  toggleButton(isSignedIn);

  signInToggle.onclick = () => {
    if (getAccessToken()) {
      signoutAccessToken();
      toggleButton(false);
    } else {
      initAuthClient(renderLoggedInApp);
      refreshAccessToken();
      toggleButton(true);
    }
  };
  const signInWithGoogleButton = document.getElementById('google-signin2');
  signInWithGoogleButton.onclick = () => {
    initAuthClient(renderLoggedInApp);
    refreshAccessToken();
    toggleButton(true);
  };


}

async function renderLoggedInApp() {
  renderApp();
  await Promise.all([
    initViewOpts(),
    initSegmentOpts(),
  ]);
}

async function init() {
  initAnalytics();

  const isSignedIn = await checkAuthStatus();
  handleSignInChange(isSignedIn);

  const state = initState((storedState) => {
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

  onDateRangeChange(state.dateRange);
  onSegmentsRecommendedChange(state.segmentsRecommended);

  await nextFrame();
  document.body.classList.add('isReady');

  if (isSignedIn) {
    await renderLoggedInApp();
  }

}

// Initialize the page.
init();
