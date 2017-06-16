const async = require('async');
const express = require('express');
const Webtask = require('webtask-tools');
const app = express();
const Request = require('request');
const memoizer = require('lru-memoizer');
const metadata = require('./webtask.json');

function lastLogCheckpoint(req, res) {
  let ctx = req.webtaskContext;
  let required_settings = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'UNBLOCK_DELAY'];
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
        const getLogsInit = (context) => {
          console.log(`Logs from: ${context.checkpointId || 'Start'}.`);

          let take = 100;

          context.logs = context.logs || [];

          getLogs(req.webtaskContext.data.AUTH0_DOMAIN, req.access_token, take, context.checkpointId, (logs, err) => {
            if (err) {
              return callback({ error: err, message: 'Error getting logs from Auth0' });
            }

	          if (logs && logs.length) {
	            for (let l in logs) {
	              if (pauseUnblocking(logs[l].date, ctx.data.UNBLOCK_DELAY)) {
	                console.log("Unblock paused..");
	                console.log('Total logs to process: ' + context.logs.length + '.');
	                return callback(null, context);
	              }
	              context.logs.push(logs[l]);
	              context.checkpointId = logs[l]._id;
	            }
	            console.log("Unblock continue..");
	            console.log('Total logs to process: ' + context.logs.length + '.');
	          } else {
	              console.log("No new logs yet.");
	          }

            return callback(null, context);
          });
        };

        getLogsInit({ checkpointId: startCheckpointId });
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
	      async.forEachSeries(context.logs, function (idx, cb) {
	        getUserId(req.webtaskContext.data.AUTH0_DOMAIN, 
	                  req.access_token,
	                  idx.connection,
	                  idx.user_name, function(userID, err){
	          if (err) {
	            return cb({ error: err, message: 'Error getting userID from Auth0' });
	          }
	        
	          unblockUser(req.webtaskContext.data.AUTH0_DOMAIN, 
	                      req.access_token,
	                      userID,function( resp, err){
	            if (err) {
	              return cb({ error: err, message: 'Error unblocking user' });
	            } 
	            console.log("USER UNBLOCKED")
	            cb();
	          })
	        });
	      }, function (err) {
	        if (err) {
	          return callback({ error: err, message: 'Error while unblocking the user' });
	        }
	        return callback(null, context);
	      });
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
        checkpointId: context.checkpointId
      }, { force: 1 }, (error) => {
        if (error) {
          return res.status(500).send({error: error, message: 'Error storing checkpoint' });
        }

        res.sendStatus(200);
      });
    });

  });
}

function getLogs (domain, token, take, from, cb) {
  let url = `https://${domain}/api/v2/logs`;

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

function getUserId(domain, token, connection, name, cb) {
  var url = 'https://' + domain + '/api/v2/users';
	var luceneq = 'name:"' + name + '" AND identities.connection:"'+ connection + '"';
	
  Request({
	  method: 'GET',
	  url: url,
	  json: true,
	  qs: {
	    search_engine: "v2",
	    q: luceneq
	  },
	  headers: {
	    Authorization: 'Bearer ' + token,
	    Accept: 'application/json'
	  }
	}, function (err, res, body) {
	  if (err) {
	    console.log('Error getting user id', err);
	    cb(null, err);
	  } else {
	    // This should be a unique user because we filter
	    // with connection and user name. So getting the first
	    // item in the returned array.
      if (body.length > 1) {
        console.log("USER SHOULD BE UNIQUE!!!");
        console.log(body);
      }
      console.log("USER EMAIL =======");
	    console.log(body[0].email);
	    console.log("USER ID =======");
	    console.log(body[0].user_id);
	    cb(body[0].user_id);
	  }
	});
}

function unblockUser (domain, token, userId, cb) {
  let url = `https://${domain}/api/v2/user-blocks/${userId}`;

  Request({
    method: 'DELETE',
    url: url,
    json: true,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  }, (err, res, body) => {
    if (err) {
      console.log('Error unblocking user', err);
      cb(null, err);
    } else {
	    cb(body);
    }
  });
}

// If the log date is not old enough this functions returns true
function pauseUnblocking(logDate, unblockDelay){
  var logTime = new Date(logDate)
  var cTime = new Date();
  var res = (cTime > logTime)?(((cTime - logTime) < unblockDelay * 60 * 1000)?true:false):true;
  return res;
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
