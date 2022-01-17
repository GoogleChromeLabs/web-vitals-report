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

export function get(key) {
  let value;
  try {
    value = JSON.parse(localStorage.getItem(key));
  } catch (error) {
    // Do nothing.
  }
  return value || {};
}

export function set(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch (error) {
    // Do nothing.
  }
}
