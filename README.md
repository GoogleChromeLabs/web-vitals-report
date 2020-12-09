# ⚡ Web Vitals Report

The [Web Vitals Report](https://web-vitals-report.web.app) is a web app that makes it easy for users of the [web-vitals](https://github.com/GoogleChrome/web-vitals/) JavaScript library to create custom visualizations of the data they've [sent to Google Analytics](https://github.com/GoogleChrome/web-vitals/#send-the-results-to-google-analytics). The app is available to use as a standalone tool, or you can fork it and customize it to your needs.

* * *

<h3 align=center><a href="https://web-vitals-report.web.app">&nbsp;Launch Web Vitals Report</a>&nbsp;&nbsp;🚀</h3>

[![web-vitals-report](https://user-images.githubusercontent.com/326742/101584324-3f9a0900-3992-11eb-8f2d-182f302fb67b.png)](https://web-vitals-report.web.app)

## Overview

Google Analytics does not currently provide out-of-the-box support for Web Vitals, but it does offer a number of options for measuring [custom events](https://support.google.com/analytics/answer/1033068), which you can then aggregate and report on manually.

If you're a current Google Analytics user, there are a lot of advantages to capturing your site's Web Vitals data in the tool you're already using. Primarily, it allows you to compare performance and page experience across your existing user [segments](https://support.google.com/analytics/answer/3123951)—to see how it affects your goals, conversions, and other business metrics.

This is critical, as it can help you answer questions like:

- How do my site's Web Vitals correlate with its **bounce rate**?
- Do pages perform better for **returning users** than **new users**?
- Are users more likely to **make a purchase** when the experience is better?

The [Web Vitals Report](https://web-vitals-report.web.app) can give you insight into all of these questions, and more!

## How to use the app

### Step 0: _(prerequisites)_

The most important step—which must be done before you can use the Web Vitals Report—is to add the [web-vitals](https://github.com/GoogleChrome/web-vitals/)  JavaScript library to your site and configure it to [send data to Google Analytics]((https://github.com/GoogleChrome/web-vitals/#send-the-results-to-google-analytics))

If you have not completed this step, you'll get an error when trying to create any reports.

### Step 1: _(authorize)_

Navigate to [web-vitals-report.web.app](https://web-vitals-report.web.app) and click the "Sign in with Google" button. The sign-in flow will prompt you for permission to allow the app to view your Google Analytics data, which is needed in order to create the report.

### Step 2: _(configure)_

After you've logged in, a form will appear asking you to select:

1. Your Google Analytics account (and [property](https://support.google.com/analytics/answer/2649554) and [view](https://support.google.com/analytics/answer/2649553))
2. A date range to query
3. Two [segments](https://support.google.com/analytics/answer/3123951) to compare results for

While the app does suggest a few interesting segments to compare, you're not limited to just these suggestions. If you select the bottom option "Choose segments", you'll be able to pick any segment you want.

If a particular segment you're interested in looking at is not in the list, you can always [create it yourself](support.google.com/analytics/answer/3124493).

#### Advanced configuration options

There is also an option to "use advanced options (configurable per account)". These options are useful if you've customized your `web-vitals` JS implementation (e.g. changed the [recommended](https://github.com/GoogleChrome/web-vitals/#send-the-results-to-google-analytics) event action or label values or the metric names). They also allow you to further filter the report (e.g. only events matching a particular [custom dimension](https://support.google.com/analytics/answer/2709828) value).

#### Filter reference

The syntax for specifying filters is based on the [format used in the Core Reporting API](https://developers.google.com/analytics/devguides/reporting/core/v3/reference#filters), with a few limitations:

- Only dimension filters are supported (no metric filters)
- Only AND combinations can be used (no OR combinations)

For example, the following filter would limit the report to only include Web Vitals events on "article" pages:

```
ga:pagePath=~^/articles/
```

And this example would limit it to just non-U.S. visitors who landed on a "product" page:

```
ga:country!=United States;ga:landingPagePath=~^/product/\d+
```

### Step 3: _(create & analyze)_

Once you've configured the report, click "Submit" to make the API request(s) and render the report.

_**NOTE:** querying your data and generating the report can sometimes take a long time, especially if your site receives a lot of traffic (>100K visitors a day). Refer to the [limitations](#limitations) section for details._

The generated report consists of a histogram and timeline for each of the [Core Web Vitals](https://web.dev/vitals/#core-web-vitals) metric, helping you visualize how the results differ by segment. It also includes a drill down of the top five countries and pages (by total number of Web Vitals events received), so you can see if certain pages or user populations perform better or worse than others.

All of the scores reported represent the value at the 75th percentile for all metric events in that segment and dimension group. To help you quickly assess your overall compliance with the Core Web Vitals thresholds, each score is colored based on the following buckets (following the thresholds outlined in [web.dev/vitals](https://web.dev/vitals/#core-web-vitals):

- **Green:** _"good"_
- **Yellow:** _"needs improvement"_
- **Red:** _"poor"_

## Limitations

While the Web Vitals Report app is powerful, it does have some limitations. In particular, large sites may find it quite slow or run up against row limitations (see below).

In general, this tool is best suited for small to mid-size websites—particularly those who are not large enough to have all their pages appear in the [Chrome User Experience Report (CrUX)](https://developers.google.com/web/tools/chrome-user-experience-report) dataset.

Sites that send fewer than 100,000 Web Vitals events per day should not have any problems using this report. For larger sites, on-demand reporting of unaggregated event data is likely not practical.

### 1 million row limit

Google Analytics imposes a limit of 1 million unique rows in each report. After 1 million rows all results are grouped into an "(other)" bucket.

Unfortunately, in order for Web Vitals Report to build a distribution and calculate the 75th percentile, it needs access to each individual event value. As a result, a report cannot be created if a site has received more than 1 million Web Vitals events per day.

Large sites still wishing to use this tool may want to consider sampling the number of events they send to Google Analytics (e.g. only send events for 10% of users). Another option is to use the [BigQuery export](https://support.google.com/analytics/answer/3437618) feature in Google Analytics, which does not have the 1 million row limit restriction. However, BigQuery export is beyond the scope of the Web Vitals Report tool.

### Google Analytics 4 (GA4) properties are not supported

At the moment, the Web Vitals Report only supports [Universal Analytics](https://support.google.com/analytics/answer/2790010) properties. [Google Analytics 4 (GA4)](https://www.blog.google/products/marketingplatform/analytics/new_google_analytics/) is not supported as it's APIs are still in [alpha preview](https://developers.google.com/analytics/devguides/reporting/data/v1) and some required features are missing.

Once the APIs are publicly available and all required features have been added, GA4 properties will be supported.

## Build and run the app locally

Developers can use the Web Vitals Report app at [web-vitals-report.web.app](https://web-vitals-report.web.app) as much as they want, but they can also fork the repo and build their own version of the tool—customizing it to meet their specific needs.

To build and run the app locally, follow these steps:

1. [Clone](https://docs.github.com/en/free-pro-team@latest/github/creating-cloning-and-archiving-repositories/cloning-a-repository) the repo (or a [fork](https://docs.github.com/en/free-pro-team@latest/github/getting-started-with-github/fork-a-repo)) to your local machine.
2. Run `npm install` to download and install all dependencies.

Before you can run the app locally, you'll need to create your own OAuth 2.0 credential in order to query the Google Analytics APIs.

3. [Create a new project](https://cloud.google.com/apis/docs/getting-started#creating_a_google_project) in the Google Cloud Console and [enable](https://cloud.google.com/apis/docs/getting-started) the following APIs:
    i. [Google Analytics API](https://console.cloud.google.com/apis/api/analytics.googleapis.com/overview)
    ii. [Analytics Reporting API](https://console.cloud.google.com/apis/api/analyticsreporting.googleapis.com/overview)
4. [Set up OAuth 2.0](https://support.google.com/cloud/answer/6158849) in your new project and create a client ID and make sure to add `localhost:4040` to the list of authorized domains.
5. In your clone of the `web-vitals-report` repo, replace the client IDs in the [`oauth.config.json`](/firebase.json) file with the client ID you just created. (The file contains separate client IDs for dev and prod builds, but it's OK to use the same client ID for both, as long as all authorized domains are correctly configured).

Once you have your own client ID, you can run the app locally:

5. Run `npm start` to build the app and start a local development server
6. Visit `localhost:4040` to use the app.

## License

[Apache 2.0](/LICENSE)
