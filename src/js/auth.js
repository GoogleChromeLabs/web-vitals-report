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

/* global gapi */

// Utility methods for dealing with Google auth:
// https://developers.google.com/identity/sign-in/web/reference

export async function checkAuthStatus() {
  // This is set on the window in `index.html`.
  await window.authorizeUser;

  return getAuthInstance().isSignedIn.get();
}

export function getAuthInstance() {
  return gapi.auth2.getAuthInstance();
}

// Can only be called if the user is signed in.
export function getAccessToken() {
  const googleUser = getAuthInstance().currentUser.get();
  const authResponse = googleUser.getAuthResponse(true);
  return authResponse.access_token;
}

export function onSignInChange(callback) {
  getAuthInstance().isSignedIn.listen(callback);
}

export async function userIsSignedIn() {
  const isSignedIn = await checkAuthStatus();

  await new Promise((resolve, reject) => {
    gapi.signin2.render('google-signin2', {
      width: 240,
      height: 50,
      longtitle: true,
      theme: 'dark',
      onsuccess: resolve,
      onfailure: reject,
    });
    // If the user is already signed in, render the button anyway but
    // resolve immediately. (We render in case the user signs out.)
    if (isSignedIn) {
      resolve();
    }
  });
}
