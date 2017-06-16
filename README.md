# Auth0 - Unblock Users

[![Auth0 Extensions](http://cdn.auth0.com/extensions/assets/badge.svg)](https://sandbox.it.auth0.com/api/run/auth0-extensions/extensions-badge?webtask_no_cache=1)

This extension will search the logs for the blocked users in your Auth0 tenant and unblock them after the configurable delay passes. 

# Disclaimer

As the blocked users will be unblocked after the configured period with <b>`UNBLOCK_DELAY`</b> option , this could be an attack surface for hackers. By using this extension, you accept the risks it may cause. 

# Best Practices

Keep <b>`UNBLOCK_DELAY`</b> reasonably long and monitor the blocked/unblocked users from logs. One way to do this is by exporting the Auth0 Logs to a third party Logging Service with one of [Auth0's Log extensions](https://auth0.com/docs/extensions#export-auth0-logs-to-an-external-service). 

In the 3rd party Logging Service, create alarms for frequent blocks for the same user. You can permanently block a user from Auth0 dashboard in such cases if required.

## Installation

* Fork this repository to your GitHub account.
* In the management dashboard [extensions](https://manage.auth0.com/#/extensions) section, enter your project's Github link in the opened window when you click <b>`+ CREATE EXTENSION`</b> button. 

## Configure Webtask

If you haven't configured Webtask on your machine run this first:

```
npm i -g wt-cli
wt init
```

> Requires at least node 4.2.2 - if you're running multiple version of node make sure to load the right version, e.g. "nvm use 4.2.2"

## Deploy to Webtask.io

To run it on a schedule (run every 5 minutes for example):

```bash
$ npm run build
$ wt cron schedule \
    --name auth0-unblock-users \
    --secret AUTH0_DOMAIN="YOUR_AUTH0_DOMAIN" \
    --secret AUTH0_GLOBAL_CLIENT_ID="YOUR_AUTH0_GLOBAL_CLIENT_ID" \
    --secret AUTH0_GLOBAL_CLIENT_SECRET="YOUR_AUTH0_GLOBAL_CLIENT_SECRET" \
    --secret UNBLOCK_DELAY="MINUTES_TO_WAIT_FOR_UNBLOCKING_USERS" \
    --secret START_FROM="OPTIONAL_LOG_ID_TO_START_FROM" \
    "*/1 * * * *" \
    build/bundle.js
```


The following settings are optional:

 - `START_FROM`: This allows you to set the log id for the extension to start. If unspecified extension cron job starts from the first log available.


> You can get your Global Client Id/Secret here: https://auth0.com/docs/api/v2

## Usage

Install the extension, and inspect unblocked users in the logs!


## How it works

This extension searches the logs with type `limit_wc` for blocked users. Once a log is found for a blocked user, extension first finds the user_id for the user and in the next step unblocks that user_id. Extension cron jobs runs with a configurable delay so any user blocked can be unblocked after the delay. Delay is set with `UNBLOCK_DELAY` parameter.

## Issue Reporting

If you have found a bug or if you have a feature request, please report them at this repository issues section. Please do not report security vulnerabilities on the public GitHub issue tracker. The [Responsible Disclosure Program](https://auth0.com/whitehat) details the procedure for disclosing security issues.

## Author

[Auth0](auth0.com)

## What is Auth0?

Auth0 helps you to:

* Add authentication with [multiple authentication sources](https://docs.auth0.com/identityproviders), either social like **Google, Facebook, Microsoft Account, LinkedIn, GitHub, Twitter, Box, Salesforce, amont others**, or enterprise identity systems like **Windows Azure AD, Google Apps, Active Directory, ADFS or any SAML Identity Provider**.
* Add authentication through more traditional **[username/password databases](https://docs.auth0.com/mysql-connection-tutorial)**.
* Add support for **[linking different user accounts](https://docs.auth0.com/link-accounts)** with the same user.
* Support for generating signed [Json Web Tokens](https://docs.auth0.com/jwt) to call your APIs and **flow the user identity** securely.
* Analytics of how, when and where users are logging in.
* Pull data from other sources and add it to the user profile, through [JavaScript rules](https://docs.auth0.com/rules).

## Create a free Auth0 Account

1. Go to [Auth0](https://auth0.com) and click Sign Up.
2. Use Google, GitHub or Microsoft Account to login.

## License

This project is licensed under the MIT license. See the [LICENSE](LICENSE) file for more info.
