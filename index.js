const async = require('async');
const express = require('express');
const Webtask = require('webtask-tools');
const app = express();
const Request = require('request');
const memoizer = require('lru-memoizer');
const metadata = require('./webtask.json');

function lastLogCheckpoint(req, res) {
  let ctx = req.webtaskContext;
  let required_settings = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'UNBLOCK_DELAY_IN_SEC'];
  let missing_settings = required_settings.filter((setting) => !ctx.data[setting]);

  if (missing_settings.length) {
    return res.status(400).send({ message: 'Missing settings: ' + missing_settings.join(', ') });
  }

  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
  req.webtaskContext.storage.get((err, data) => {
    let startFromId = ctx.data.START_FROM ? ctx.data.START_FROM : null;
    let startCheckpointId = typeof data === 'undefined' ? startFromId : data.checkpointId;

    // Start the process.
    async.waterfall([
      (callback) => {
        const getLogs = (context) => {
          console.log(`Logs from: ${context.checkpointId || 'Start'}.`);

          let take = 100;

          context.logs = context.logs || [];

          getLogsFromAuth0(req.webtaskContext.data.AUTH0_DOMAIN, req.access_token, take, context.checkpointId, (logs, err) => {
            if (err) {
              return callback({ error: err, message: 'Error getting logs from Auth0' });
            }

            if (logs && logs.length) {
              logs.forEach((l) => context.logs.push(l));
              context.checkpointId = context.logs[context.logs.length - 1]._id;
            }

            console.log(`Total logs: ${context.logs.length}.`);
            return callback(null, context);
          });
        };

        getLogs({ checkpointId: startCheckpointId });
      },
      (context, callback) => {
        const types_filter = [`limit_wc`];
        const log_matches_types = (log) => {
          if (!types_filter || !types_filter.length) return true;
          return log.type && types_filter.indexOf(log.type) >= 0;
        };

        context.logs = context.logs
          .filter(log_matches_types);

        callback(null, context);
      },
      (context, callback) => {
        console.log('Find the user id for the users to unblock');
      }
    ], function (err, context) {
      if (err) {
        console.log('Job failed.', err);

        return req.webtaskContext.storage.set({ checkpointId: startCheckpointId }, { force: 1 }, (error) => {
          if (error) {
            return res.status(500).send({ error: error, message: 'Error storing startCheckpoint' });
          }

          res.status(500).send(err);
        });
      }

      console.log('Job complete.');

      return req.webtaskContext.storage.set({
        checkpointId: context.checkpointId,
        totalLogsProcessed: context.logs.length
      }, { force: 1 }, (error) => {
        if (error) {
          return res.status(500).send({error: error, message: 'Error storing checkpoint' });
        }

        res.sendStatus(200);
      });
    });

  });
}

function getLogsFromAuth0 (domain, token, take, from, cb) {
  var url = `https://${domain}/api/v2/logs`;

  Request({
    method: 'GET',
    url: url,
    json: true,
    qs: {
      take: take,
      from: from,
      sort: 'date:1',
      per_page: take
    },
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  }, (err, res, body) => {
    if (err) {
      console.log('Error getting logs', err);
      cb(null, err);
    } else {
      cb(body);
    }
  });
}

const getTokenCached = memoizer({
  load: (apiUrl, audience, clientId, clientSecret, cb) => {
    Request({
      method: 'POST',
      url: apiUrl,
      json: true,
      body: {
        audience: audience,
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      }
    }, (err, res, body) => {
      if (err) {
        cb(null, err);
      } else {
        cb(body.access_token);
      }
    });
  },
  hash: (apiUrl) => apiUrl,
  max: 100,
  maxAge: 1000 * 60 * 60
});

app.use(function (req, res, next) {
  var apiUrl       = `https://${req.webtaskContext.data.AUTH0_DOMAIN}/oauth/token`;
  var audience     = `https://${req.webtaskContext.data.AUTH0_DOMAIN}/api/v2/`;
  var clientId     = req.webtaskContext.data.AUTH0_CLIENT_ID;
  var clientSecret = req.webtaskContext.data.AUTH0_CLIENT_SECRET;

  getTokenCached(apiUrl, audience, clientId, clientSecret, function (access_token, err) {
    if (err) {
      console.log('Error getting access_token', err);
      return next(err);
    }

    req.access_token = access_token;
    next();
  });
});

app.get('/', lastLogCheckpoint);
app.post('/', lastLogCheckpoint);

// This endpoint would be called by webtask-gallery when the extension is installed as custom-extension
app.get('/meta', (req, res) => {
  res.status(200).send(metadata);
});

module.exports = Webtask.fromExpress(app);
