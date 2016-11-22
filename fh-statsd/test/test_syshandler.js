// Test suite for the feedhenry sys/info
var assert = require('assert');
var statsserver = require("statsserver");
var fh_logger = require('fh-logger');

var config = {
  "statsserver": {
    "port": 9876,
    "connect": {
      "level": "log4js.levels.INFO"
    }
  }
};

var logger = fh_logger.createLogger({name: 'test_syshandler', level: 'trace'});

exports.testDefault = function(beforeExit) {
  var statsServer;
  var numTests = 1;

  beforeExit(function() {
    assert.equal(numTests, 0, "not all tests were run");
  });

  statsServer = new statsserver.StatsServer(config, logger, "9.8.7-Test Version", null);

  assert.response(statsServer.server,
    {url: '/unknown_file'},
    function(res) {
      logger.info('statusCode', res.statusCode);
      process.nextTick(function() {
        numTests -= 1;
        assert.equal(403, res.statusCode);
        statsServer.close();
      });
    }
    );
};


exports.testSysInfo = function(beforeExit) {
  var statsServer;
  var numTests = 2;

  beforeExit(function() {
    assert.equal(numTests, 0, "not all tests were run");
  });

  statsServer = new statsserver.StatsServer(config, logger, "9.8.7-Test Version", null);

  assert.response(statsServer.server,
    {url: '/sys/info/ping'},
    {status: 200},
    function(res) {
      var msg = JSON.parse(res.body);
      process.nextTick(function() {
        numTests -= 1;
        assert.equal("OK", msg);
      });
    }
  );

  assert.response(statsServer.server,
    {url: '/sys/info/version'},
    {status: 200},
    function(res) {
      var msg = JSON.parse(res.body);
      process.nextTick(function() {
        numTests -= 1;
        assert.match(msg, /^9.8.7-Test Version$/);
        statsServer.close();
      });
    }
    );
};
