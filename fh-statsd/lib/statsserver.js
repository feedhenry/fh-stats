var http = require('http');
var express = require('express');
var stats = require('./stats.js');
var bodyParser = require('body-parser');

var config;
var logger;
var versionNumber;

function fhApiKeyAuth(headerName, apiKey) {
  return function(req, res, next) {
    if ((req.headers) && (req.headers[headerName]) && (req.headers[headerName] === apiKey)) {
      next();
    } else {
      logger.error("Stats called with invalid APIKey");
      logger.trace({apiKey: apiKey}, "expected key");
      logger.trace("received key: " + ((req.headers) && (req.headers[headerName]))?req.headers[headerName]:"");
      logger.trace("header: " + headerName);
      logger.trace("headers: " + JSON.stringify(req.headers));
      res.writeHead(403, "Forbidden");
      res.end();
    }
  };
}

var StatsServer = function(cfg, lgr, statsdVersionNumber) {
  config = cfg;
  logger = lgr;
  versionNumber = statsdVersionNumber;
  logger.info("IN SS constructor: config == " + JSON.stringify(config));

  this.app = express();
  if (logger.requestIdMiddleware) {
    this.app.use(logger.requestIdMiddleware);
  }
  /**
   * Trace logging for http requests
   */
  this.app.use(function(req, res, next) {
    logger.trace(req);
    next();
  });
  this.app.
    use(bodyParser.urlencoded({ extended: false })).
    use(bodyParser.json({})).
    use('/sys', this.sys_handler).
    use(fhApiKeyAuth("x-feedhenry-statsapikey", config.statsserver.statsAPIKey)).
    use('/stats', this.stats_handler).
    use(this.default_handler);

  this.server = http.createServer(this.app);
  stats.createStatsCollectorServer(cfg.statsserver.statscollector, logger);
};

StatsServer.prototype.close = function() {
  stats.close();
};

StatsServer.prototype.sys_handler = (function() {
  var router = new express.Router();
  router.get('/info/ping', function(req, res) {
    res.end(JSON.stringify("OK"));
  });
  router.get('/info/version', function(req, res) {
    res.end(JSON.stringify(versionNumber));
  });
  return router;
})();

StatsServer.prototype.stats_handler = (function() {
  var router = new express.Router();
  router.get('/report', function(req, res) {
    var result = stats.getLastReport();
    res.end(result);
  });
  router.get('/stats', function(req, res) {
    var result = stats.getStats();
    res.end(result);
  });
  router.get('/counters', function(req, res) {
    var result = stats.getCounters();
    res.end(JSON.stringify(result));
  });
  router.post('/counters', function(req, res) {
    var f = req.body.f;
    var result = stats.getCounters(f);
    res.end(JSON.stringify(result));
  });
  router.get('/timers', function(req, res) {
    var result = stats.getTimers();
    res.end(JSON.stringify(result));
  });
  router.post('/timers', function(req, res) {
    var f = req.body.f;
    var result = stats.getTimers(f);
    res.end(JSON.stringify(result));
  });
  router.get('/gauges', function(req, res) {
    var result = stats.getGauges();
    res.end(JSON.stringify(result));
  });
  router.post('/gauges', function(req, res) {
    var f = req.body.f;
    var result = stats.getGauges(f);
    res.end(JSON.stringify(result));
  });
  router.get('/history', function(req, res) {
    var result = stats.getHistory();
    res.end(JSON.stringify(result));
  });
  router.post('/history', function(req, res) {
    var f = req.body.f;
    var numResults = req.body.counter;
    logger.debug("getHistory - statPrefixFilter: " + f + ", numResults: " + numResults);
    var result = stats.getHistory(f, numResults);
    res.end(JSON.stringify(result));
  });
  router.get('/current', function(req, res) {
    var result = stats.getCurrent();
    res.end(JSON.stringify(result));
  });
  router.post('/current', function(req, res) {
    var f = req.body.f;
    var result = stats.getCurrent(f);
    res.end(JSON.stringify(result));
  });
  return router;
})();

StatsServer.prototype.default_handler = function(req, res) {
  res.statusCode = 404;
  res.write("Unknown request: " + req.url);
  res.end();
};

exports.StatsServer = StatsServer;
