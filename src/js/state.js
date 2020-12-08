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

let state = {};
const listenerMap = new Map();

export function initState(initializer) {
  let storedState = {};
  try {
    storedState = JSON.parse(localStorage.getItem('state'));
  } catch (error) {
    // Do nothing.
  }
  Object.assign(state, initializer(storedState));

  document.addEventListener('visibilitychange', () => {
    localStorage.setItem('state', JSON.stringify(state));
  });

  return state;
}

export function addChangeListener(key, callback) {
  let listeners = listenerMap.get(key);
  if (!listeners) {
    listeners = new Set();
    listenerMap.set(key, listeners);
  }
  listeners.add(callback);
}

function runChangeListeners(key, ...args) {
  const listeners = listenerMap.get(key);
  if (listeners) {
    for (const listener of listeners) {
      listener(...args);
    }
  }
}

export function setState(updates) {
  let stateDidChange = false;
  const oldState = state;
  state = Object.assign({}, state, updates);

  for (const [key, value] of Object.entries(updates)) {
    if (oldState[key] !== value) {
      stateDidChange = true;
      console.log('change', key, value, oldState[key]);
      runChangeListeners(key, value, oldState[key]);
    }
  }
  if (stateDidChange) {
    runChangeListeners('*');
  }
}

export function getState() {
  return state;
}
