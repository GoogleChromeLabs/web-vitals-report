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

import {html, render, svg} from 'lit-html';
import {nextFrame, timeout} from './utils.js';


const ALERT_TRANSITION_TIME = 200;

const state = {};
let alertShowing = false;

/**
 * Returns the markup to generate an SVG icon.
 * @param {string} id The icon id from the main icons file.
 * @return {string} The icon markup.
 */
function renderIcon(id) {
  const xlinkHref = `#icon-${id}`;
  return svg`<svg class="Icon" viewBox="0 0 24 24">
    <use href=${xlinkHref}></use>
  </svg>`;
}

function renderAlert() {
  const classes = ['Alert'];
  if (state.isTransitioning) classes.push('Alert--isTransitioning');
  if (state.isActive) classes.push('Alert--isActive');

  return html`
    <div class=${classes.join(' ')}>
      <div class="Alert-icon">
        ${renderIcon('error-outline')}
      </div>
      <div class="Alert-body">
        <h1 class="Alert-title">${state.title}</h1>
        <div class="Alert-message">${state.body}</div>
      </div>
      <button @click=${remove} class="Alert-close">
        ${renderIcon('close')}
      </button>
    </div>
  `;
}

function onContainerClick(event) {
  if (event.target === event.currentTarget) {
    remove();
  }
}

function renderAlertContainer() {
  render(alertShowing ? html`
    <div @click=${onContainerClick} class="AlertContainer">
      ${renderAlert()}
    </div>
  ` : undefined, document.getElementById('alerts'));
}

async function transition(isActive) {
  await nextFrame();
  state.isActive = isActive;
  state.isTransitioning = true;
  renderAlertContainer();

  await timeout(ALERT_TRANSITION_TIME);

  state.isActive = isActive;
  state.isTransitioning = false;
  renderAlertContainer();
}

async function remove() {
  if (!alertShowing) return;

  await transition(false);

  alertShowing = false;
  renderAlertContainer();
}

export async function addAlert(data) {
  if (alertShowing) {
    await remove();
  }

  Object.assign(state, data);
  alertShowing = true;
  renderAlertContainer();

  await transition(true);
  document.getElementById('alerts').focus();
}
