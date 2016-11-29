// Copyright (c) 2010 Etsy
//
// Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software and associated documentation
// files (the "Software"), to deal in the Software without
/// restriction, including without limitation the rights to use,
// copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following
// conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
// OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
// HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
// WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.
//

var dgram  = require('dgram')
  , util    = require('util')
  , net    = require('net')
  , fs     = require('fs');

var logger;
var keyCounter = {};
var counters = {};
var timers = {};
var gauges = {};
var debugInt, flushInt, keyFlushInt, server;
var startup_time = Math.round(new Date().getTime() / 1000);
var history = [];
var history_keep_size;
var last_report = "";
var flushInterval;

var stats = {
  graphite: {
    last_flush: startup_time,
    last_exception: startup_time
  },
  messages: {
    last_msg_seen: startup_time,
    bad_lines_seen: 0
  }
};

function close() {
  if(server) {
    try {
      server.close();
    }
    catch(e) {
      // ignore errors closing socket
    }
  }
}

function save_history(new_hist_entry) {
  history.push(new_hist_entry);
  if (history.length > history_keep_size) {
    history.splice(0, 1);
  }
}

function createStatsCollectorServer(config, lgr) {
  if (!config) {
    return;
  }

  logger = lgr;
  logger.debug("cscs called with: ", config);
  if (! config.debug && debugInt) {
    clearInterval(debugInt);
    debugInt = false;
  }

  if (config.debug) {
    if (debugInt !== undefined) {
      clearInterval(debugInt);
    }
    debugInt = setInterval(function() {
      logger.debug("Counters:\n" + util.inspect(counters) +
               "\nTimers:\n" + util.inspect(timers) +
               "\nGauges:\n" + util.inspect(gauges));
    }, config.debugInterval || 10000);
  }

  history_keep_size = config.historyLen || 360;

  if (server === undefined) {

    // key counting
    var keyFlushInterval = Number((config.keyFlush && config.keyFlush.interval) || 0);

    server = dgram.createSocket('udp4', function(msg) {
      if (config.dumpMessages) {
        logger.debug(msg.toString());
      }
      var bits = msg.toString().split(':');
      var key = bits.shift()
                    .replace(/\s+/g, '_')
                    .replace(/\//g, '-')
                    .replace(/[^a-zA-Z_\-0-9\.]/g, '');

      if (keyFlushInterval > 0) {
        if (! keyCounter[key]) {
          keyCounter[key] = 0;
        }
        keyCounter[key] += 1;
      }

      if (bits.length == 0) { // jshint ignore:line
        bits.push("1");
      }

      for (var i = 0; i < bits.length; i++) {
        var sampleRate = 1;
        var fields = bits[i].split("|");
        if (fields[1] === undefined) {
          logger.error('Bad line: ' + fields);
          stats['messages']['bad_lines_seen']++;
          continue;
        }
        if (fields[1].trim() == "ms") { // jshint ignore:line
          if (! timers[key]) {
            timers[key] = [];
          }
          timers[key].push(Number(fields[0] || 0));
        } else if (fields[1].trim() == "g") { // jshint ignore:line
          gauges[key] = Number(fields[0] || 0);
        } else {
          if (fields[2] && fields[2].match(/^@([\d\.]+)/)) {
            sampleRate = Number(fields[2].match(/^@([\d\.]+)/)[1]);
          }
          if (! counters[key]) {
            counters[key] = 0;
          }
          counters[key] += Number(fields[0] || 1) * (1 / sampleRate);
        }
      }

      stats['messages']['last_msg_seen'] = Math.round(new Date().getTime() / 1000);
    });

    server.bind(config.port || 8125, config.address || undefined);

    logger.info("Started fh-statsd");

    flushInterval = Number(config.flushInterval || 10000);

    var pctThreshold = config.percentThreshold || 90;
    if (!Array.isArray(pctThreshold)) {
      pctThreshold = [ pctThreshold ]; // listify percentiles so single values work the same
    }

    flushInt = setInterval(function() {
      var statString = '';
      var ts_millis = new Date().getTime();
      var ts = Math.round(ts_millis / 1000);
      var numStats = 0;
      var key;

      var hist_entry = {};
      hist_entry.ts = ts_millis;
      hist_entry.counters = [];

      for (key in counters) {
        var value = counters[key];
        var valuePerSecond = value / (flushInterval / 1000); // calculate "per second" rate

        statString += 'stats.'        + key + ' ' + valuePerSecond + ' ' + ts + "\n";
        statString += 'stats_counts.' + key + ' ' + value          + ' ' + ts + "\n";

        hist_entry.counters.push({key: key, value: { value: value, valuePerSecond: valuePerSecond}});
        numStats += 1;
      }

      hist_entry.timers = [];
      var sorter = function(a, b) { return a-b; };
      for (key in timers) {
        if (timers[key].length > 0) {
          var values = timers[key].sort(sorter);
          var count = values.length;
          var min = values[0];
          var max = values[count - 1];

          var mean = min;
          var maxAtThreshold = max;

          var message = "";

          var key2;

          var key2_pcts = [];

          for (key2 in pctThreshold) {
            var pct = pctThreshold[key2];
            if (count > 1) {
              var thresholdIndex = Math.round(((100 - pct) / 100) * count);
              var numInThreshold = count - thresholdIndex;
              var pctValues = values.slice(0, numInThreshold);
              maxAtThreshold = pctValues[numInThreshold - 1];

              // average the remaining timings
              var sum = 0;
              for (var i = 0; i < numInThreshold; i++) {
                sum += pctValues[i];
              }

              mean = sum / numInThreshold;
            }

            var clean_pct = '' + pct;
            clean_pct.replace('.', '_');
            message += 'stats.timers.' + key + '.mean_'  + clean_pct + ' ' + mean           + ' ' + ts + "\n";
            message += 'stats.timers.' + key + '.upper_' + clean_pct + ' ' + maxAtThreshold + ' ' + ts + "\n";
            key2_pcts.push({pct: clean_pct, value: {mean: mean, upper: maxAtThreshold}});
          }

          timers[key] = [];

          hist_entry.timers.push({key:key, value:{upper: max, lower: min, count: count, pcts: key2_pcts}});
          message += 'stats.timers.' + key + '.upper ' + max   + ' ' + ts + "\n";
          message += 'stats.timers.' + key + '.lower ' + min   + ' ' + ts + "\n";
          message += 'stats.timers.' + key + '.count ' + count + ' ' + ts + "\n";
          statString += message;

          numStats += 1;
        }
      }
      hist_entry.gauges = [];
      for (key in gauges) {
        statString += 'stats.gauges.' + key + ' ' + gauges[key] + ' ' + ts + "\n";
        hist_entry.gauges.push({key:key, value: gauges[key]});
        numStats += 1;
      }

      statString += 'statsd.numStats ' + numStats + ' ' + ts + "\n";
      hist_entry.numStats = numStats;

      save_history(JSON.parse(JSON.stringify(hist_entry)));

      last_report = statString;

      if (config.graphiteHost) {
        try {
          var graphite = net.createConnection(config.graphitePort, config.graphiteHost);
          graphite.addListener('error', function(connectionException) {
            if (config.debug) {
              logger.error(connectionException);
            }
          });
          graphite.on('connect', function() {
            this.write(statString);
            this.end();
            stats['graphite']['last_flush'] = Math.round(new Date().getTime() / 1000);
          });
        } catch(e) {
          if (config.debug) {
            logger.error(e);
          }
          stats['graphite']['last_exception'] = Math.round(new Date().getTime() / 1000);
        }
      }

    }, flushInterval);

    if (keyFlushInterval > 0) {
      var keyFlushPercent = Number((config.keyFlush && config.keyFlush.percent) || 100);
      var keyFlushLog = (config.keyFlush && config.keyFlush.log) || "stdout";

      keyFlushInt = setInterval(function() {
        var key;
        var sortedKeys = [];

        for (key in keyCounter) {
          sortedKeys.push([key, keyCounter[key]]);
        }

        sortedKeys.sort(function(a, b) { return b[1] - a[1]; });

        var logMessage = "";
        var timeString = (new Date()) + "";

        // only show the top "keyFlushPercent" keys
        for (var i = 0, e = sortedKeys.length * (keyFlushPercent / 100); i < e; i++) {
          logMessage += timeString + " " + sortedKeys[i][1] + " " + sortedKeys[i][0] + "\n";
        }

        var logFile = fs.createWriteStream(keyFlushLog, {flags: 'a+'});
        logFile.write(logMessage);
        logFile.end();

        // clear the counter
        keyCounter = {};
      }, keyFlushInterval);
    }

  }
}

function getStats() {
  var now    = Math.round(new Date().getTime() / 1000);
  var uptime = now - startup_time;

  var result = "";
  result += "uptime: " + uptime + "\n";

  for (var group in stats) {
    for (var metric in stats[group]) {
      var val;

      if (metric.match("^last_")) {
        val = now - stats[group][metric];
      }
      else {
        val = stats[group][metric];
      }

      result += group + "." + metric + ": " + val + "\n";
    }
  }

  return result;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function filterFields(object, filter) {
  filter = filter || "";
  var filtered_object = {};
  for (var fieldName in object) {
    if (fieldName.indexOf(filter) !== -1) {
      filtered_object[fieldName] = clone(object[fieldName]);
    }
  }

  return filtered_object;
}

function getCounters(filter) {
  return filterFields(counters, filter);
}

function getTimers(filter) {
  return filterFields(timers, filter);
}

function getGauges(filter) {
  return filterFields(gauges, filter);
}

function getCurrent(filter) {
  return {
    counters: getCounters(filter),
    timers: getTimers(filter),
    gauges: getGauges(filter)
  };
}

function getLastReport() {
  return last_report;
}

function filterArray(ary, filter) {
  var filtered_ary = [];
  var i, len;

  filter = filter || "";

  for (i = 0, len = ary.length; i < len; i += 1) {
    if ((ary[i]) && (ary[i].key) && (ary[i].key.indexOf(filter) !== -1)) {
      filtered_ary.push(clone(ary[i]));
    }
  }
  return filtered_ary;
}


function filterHistory(history, filter) {
  var filtered_history = [];
  var i, len;
  var filtered_history_entry;

  for (i = 0, len = history.length; i < len; i += 1) {
    filtered_history_entry = {};
    filtered_history_entry.numStats = history[i].numStats;
    filtered_history_entry.ts =  history[i].ts;
    filtered_history_entry.counters = filterArray(history[i].counters, filter);
    filtered_history_entry.timers = filterArray(history[i].timers, filter);
    filtered_history_entry.gauges = filterArray(history[i].gauges, filter);
    filtered_history.push(clone(filtered_history_entry));
  }
  return filtered_history;
}

function getHistory(filter, numResults) {
  var results = filterHistory(history, filter);
  if (numResults) {
    numResults = 0 - numResults;
    results = results.slice(numResults);
  }

  return {interval: flushInterval, results: results};
}

exports.createStatsCollectorServer = createStatsCollectorServer;
exports.close = close;
exports.getStats = getStats;
exports.getGauges = getGauges;
exports.getTimers = getTimers;
exports.getCounters = getCounters;
exports.getLastReport = getLastReport;
exports.getHistory = getHistory;
exports.getCurrent = getCurrent;
