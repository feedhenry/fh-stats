// Test suite for the feedhenry sys/info
const request = require("request");
const util = require('util');
const assert = require('assert');
const statsserver = require("statsserver");
const fh_logger = require('fh-logger');

const logger = fh_logger.createLogger({name: 'test_syshandler', level: 'trace'});
const config = {
  "statsserver": {
    "port": 9876,
    "connect": {
      "level": "log4js.levels.INFO"
    }
  }
};

const statsServer = new statsserver.StatsServer(config, logger, "9.8.7-Test Version");

exports.before = function before(done) {
  return statsServer.server.listen(config.statsserver.port, done);
};

exports.after = function after(done) {
  statsServer.server.close();
  return done();
};

exports.it_should_test_sys_info_ping = function(done) {
  return request('http://localhost:9876/sys/info/ping', function(err, response, body) {
    assert.ok(!err, 'Unexpected error: ', util.inspect(err));
    assert.equal(response.statusCode, 200, 'Unexpected statusCode: ', response.statusCode + ' - ' + util.inspect(body));
    assert.equal(body, '"OK"');
    return done();
  });
};

exports.it_should_test_sys_info_version = function(done) {
  return request('http://localhost:9876/sys/info/version', function(err, response, body) {
    assert.ok(!err, 'Unexpected error: ', util.inspect(err));
    assert.equal(response.statusCode, 200, 'Unexpected statusCode: ', response.statusCode + ' - ' + util.inspect(body));
    assert.ok(body);
    return done();
  });
};
