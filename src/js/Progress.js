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

class Progress {
  init(onChange) {
    this._total = 0;
    this._cur = 0;

    this._percentage = 0;
    this._startTime = performance.now();
    this._timeout;

    this._onChange = () => {
      clearTimeout(this._timeout);
      if (performance.now() > this._startTime + 1000) {
        onChange();
      } else {
        this._timeout = setTimeout(onChange, 1000);
      }
    };
  }

  get percentage() {
    return this._percentage;
  }

  get cur() {
    return this._cur;
  }

  set cur(val) {
    this._cur = val;
    this._updatePercentage();
  }

  get total() {
    return this._total;
  }

  set total(val) {
    this._total = val;
    this._updatePercentage();
  }

  _updatePercentage() {
    // Cap the % at 99 to account for chart render time.
    const pct = Math.min(99, Math.floor(this._cur * 100 / this._total));
    this._percentage = Math.max(this._percentage, pct);
    this._onChange();
  }
}

export const progress = new Progress();
