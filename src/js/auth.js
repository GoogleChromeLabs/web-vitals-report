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

// Utility methods for dealing with Google auth:
// https://developers.google.com/identity/oauth2/web/guides/use-token-model

window.tokenPromise = new Promise((resolve, reject) => {
  window.tokenLoadOkay = resolve;
  window.tokenLoadFail = reject;
});

let tokenClient;
let access_token;

const client_id = window.client_id;
const scope = window.scope;

export async function initAuthClient() {

  tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: client_id,
      scope: scope,
      callback: (tokenResponse) => {
        access_token = tokenResponse.access_token;
        tokenLoadOkay();
      }
  });
  tokenClient.requestAccessToken();
}

export async function initAuth() {
  document.getElementById('gis').addEventListener('load', initAuthClient);
}

export async function signoutAccessToken() {
  google.accounts.oauth2.revoke(access_token);
  access_token = null;
}

export async function refreshAccessToken() {
  tokenClient.requestAccessToken();
  return access_token;
}

export async function checkAuthStatus() {
  // This is set on the window in `index.html`.
  await tokenPromise;
  return !!getAccessToken();

}

// Can only be called if the user is signed in.
export function getAccessToken() {
  return access_token;
}
