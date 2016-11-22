#!/usr/bin/env node
var dgram  = require('dgram');
var util = require('util');
var net = require('net');
var config = require('./config');
var fs = require('fs');
var path = require('path');
var nc=require('ncurses');
fs.exists = fs.exists || path.exists;
fs.existsSync = fs.existsSync || path.existsSync;
var opt = require('optimist');
var argv = opt
    .usage('fh-top.\nUsage: $0')
    .boolean('a')
    .alias('a', 'attach')
    .describe('a', 'Attach to existing fh-top instance (using the mamangement port)')
    .alias('c', 'configfile')
    .describe('c', 'Config file to use')
    .boolean('d')
    .alias('d', 'daemon')
    .describe('d', 'Run in daemon mode (no top window but still collect stats on udp port')
    .alias('f', 'filter')
    .describe('f', "Filter to use, e.g. 'foo' will filter all stats that contain 'foo'")
    .alias('h', 'help')
    .describe('h', 'help')
    .alias('l', 'loadLogFile')
    .describe('l', 'LogFile, if specified, will start fh-top with the interal data specified in this state file')
    .alias('s', 'saveLogFile')
    .describe('s', 'LogFile, if specified, all internal data will be periodically saved to this state file')
    .argv
;

if (argv.help) {
  opt.showHelp();
  process.exit();
}

var configFile = argv.configfile || '/etc/feedhenry/fh-top/conf.json';
if (!fs.existsSync(configFile)) {
  console.error("Config file: '" + configFile + "' does not exist!");
  process.exit(1);
}

// Apply filter to messages, e.g. 'fh-top vmware' will filter just all messages that start with 'vmware'
var filter = argv.filter;
var attachMode = argv.attach;
var daemonMode = argv.daemon;
var loadLogFile = argv.loadLogFile;
var saveLogFile = argv.saveLogFile;

// create ncurses window
var w = daemonMode === true? null : new nc.Window();

var keyCounter = {};
var counters = {};
var gauges = {};
var timers = {};
var debugInt, flushInt, refreshInt, keyFlushInterval, server, mgmtServer, streamServer;
var startup_time = Math.round(new Date().getTime() / 1000);

// possibly unused
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

// padding helper functions
function times(str, num) {
  var ret = '';
  for (var i=0; i<num; i++)
    ret += str;
  return ret;
}

function pad(str, which, amount, padchar) {
  padchar = padchar || ' ';
  amount -= str.length;
  if (amount > 0) {
    var nbefore = 0, nafter = 0;
    if (which !== 'left') {
      if (which === 'center') {
        nbefore = Math.floor(amount/2);
        nafter = amount - nbefore;
      } else
        nbefore = amount;
    }
    str = times(padchar, nbefore) + str + times(padchar, nafter);
  }
  return str;
}

// print the very top output
function printTop() {
  w.attron(nc.attrs.STANDOUT);
  w.label("fh-top");
  w.attroff(nc.attrs.STANDOUT);

  var now = Math.round(new Date().getTime() / 1000);
  var uptime = now - startup_time;

  var numCounters, numTimers, numGauges = 0;
  var maxCounterName, maxGaugeName = 7;
  for (var c in counters) {
    numCounters++;
    if (c.length > maxCounterName) {
      maxCounterName = c.length;
    }
  }

  for (var g in gauges) {
    numGauges++;
    if (g.length > maxGaugeName) {
      maxGaugeName = g.length;
    }
  }
  // jshint ignore:start
  for (var t in timers) {
    numTimers++;
  }
  // jshint ignore:end

  var row = 1;
  w.print(row,0,'Uptime: ' + uptime + "s Num Counters: " + numCounters + " Num Gauges: " + numGauges + " Num Timers: " + numTimers);
  w.print(++row,0, '');

  if (numCounters !== 0) {
    w.attron(nc.attrs.STANDOUT);
    row +=1;
    w.print(row, 0, pad('COUNTERS', 'center', maxCounterName + 1) + pad('NUM', 'center', 10));
    w.attroff(nc.attrs.STANDOUT);
  }

  w.cursor(2,0);
  return row;
}

// print our timer information
function printTimers(row) {
  var numTimers = 0;
  var maxTimerName = 6;
  for (var t in timers) {
    numTimers++;
    if (t.length > maxTimerName) {
      maxTimerName = t.length;
    }
  }

  if (numTimers !== 0) {
    w.attron(nc.attrs.STANDOUT);
    row +=1;
    var headers = getTimingHeaders();
    var hdz = '';
    for (var z=0; z<headers.length; z++) {
      hdz += pad(headers[z], 'center', 10);
    }
    w.print(row, 0, pad('TIMERS', 'center', maxTimerName + 1) + hdz);
    w.attroff(nc.attrs.STANDOUT);
  }
  return row;
}

// do our timing calculations
function calcTimings(key) {
  var pctThreshold = config.percentThreshold || 90;
  if (!Array.isArray(pctThreshold)) {
    pctThreshold = [ pctThreshold ]; // listify percentiles so single values work the same
  }

  var timings;
  if (timers[key].length > 0) {
    var last = timers[key][(timers[key].length -1)];
    var copy = timers[key].slice(0);
    var values = copy.sort(function (a,b) { return a-b; });
    var count = values.length;
    var min = values[0];
    var max = values[count - 1];
    var mean = min;
    var maxAtThreshold = max;

    timings = {
      last: last,
      upper: max,
      lower: min,
      count: count
    };

    var key2;
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
        mean = Math.round(mean * Math.pow(10,3))/Math.pow(10,3);
      }

      var clean_pct = '' + pct;
      clean_pct.replace('.', '_');
      timings['mean_' + clean_pct] = mean;
      timings['upper_' + clean_pct] = maxAtThreshold;
    }
  }
  return timings;
}

// redrawn the ncurses window with updated data
function refresh() {
  // sort counters
  var maxCounterName = 7;
  var maxGaugeName = 5;
  var sortedCounters = [];
  var haveCounters = false;
  for (var c in counters) {
    haveCounters = true;
    if (c.length > maxCounterName) {
      maxCounterName = c.length;
    }
    sortedCounters.push([c, counters[c]]);
  }
  sortedCounters.sort(function(a, b) {return b[1] - a[1];});

  var sortedGauges = [];
  var haveGauges = false;
  for (var g in gauges) {
    haveGauges = true;
    if (g.length > maxGaugeName) maxGaugeName = g.length;
    sortedGauges.push([g, gauges[g]]);
  }
  sortedGauges.sort(function(a, b) {return b[1] - a[1];});

  w.clear();
  var row = printTop();
  for (var i=0; i<sortedCounters.length; i++) {
    var counter = sortedCounters[i][0];
    var value = sortedCounters[i][1];

    row+=1;
    w.print(row, 0, counter);
    w.print(row, maxCounterName, pad(''+value, 'center', 10));
  }
  if (haveCounters) {
    row+=1;
  }

  // print Gauges
  var numGauges = 0;
  for (var ga in gauges) { // jshint ignore:line
    numGauges++;
    if (ga.length > maxGaugeName) maxGaugeName = ga.length;
  }

  if (numGauges !== 0) { // jshint ignore:line
    w.attron(nc.attrs.STANDOUT);
    row +=1;
    w.print(row, 0, pad('GAUGES', 'center', maxGaugeName + 1) + pad('NUM', 'center', 15));
    w.attroff(nc.attrs.STANDOUT);
  }

  for (var i=0; i<sortedGauges.length; i++) { // jshint ignore:line
    var guage = sortedGauges[i][0];
    var value = sortedGauges[i][1]; // jshint ignore:line

    row+=1;
    w.print(row, 0, guage);
    w.print(row, maxGaugeName, pad(''+value, 'center', 15));
  }

  if (haveGauges) {
    row+=1;
  }

  row = printTimers(row);

  // sort timers
  var maxTimerName = 7;
  var sortedTimers = [];
  for (var t in timers) {
    if (t.length > maxTimerName) maxTimerName = t.length;
    var tgs = calcTimings(t);
    sortedTimers.push([t, tgs]);
  }
  // TODO - want highest value of 'last' to be on top

  for (var i=0; i<sortedTimers.length; i++) { // jshint ignore:line
    var timer = sortedTimers[i][0];
    var tmngs = sortedTimers[i][1];

    row+=1;
    w.print(row, 0, timer);

    // TODO - refactor
    var ta = [];
    for (var t in tmngs) { // jshint ignore:line
      ta.push(tmngs[t]);
    }

    var hdz = '';
    for (var z=0; z<ta.length; z++) {
      hdz += pad(''+ta[z], 'center', 10);
    }
    w.print(row, maxTimerName + 1, hdz);
  }

  w.cursor(2,0);
  w.refresh();
}

// setup our UDP server
function createUDPServer(config) {
  // key counting
  keyFlushInterval = Number(config.keyFlush && config.keyFlush.interval) || 0;

  var server = dgram.createSocket('udp4', function (msg){
    if (config.dumpMessages) { util.log(msg.toString()); }
    var bits = msg.toString().split(':');
    var key = bits.shift()
                    .replace(/\s+/g, '_')
                    .replace(/\//g, '-')
                    .replace(/[^a-zA-Z_\-0-9\.]/g, '');

    if (!filter || (filter && key.indexOf(filter) !== -1)) {
      if (keyFlushInterval > 0) {
        if (! keyCounter[key]) {
          keyCounter[key] = 0;
        }
        keyCounter[key] += 1;
      }

      if (bits.length === 0) {
        bits.push("1");
      }

      for (var i = 0; i < bits.length; i++) {
        var sampleRate = 1;
        var fields = bits[i].split("|");
        if (fields[1] === undefined) {
          util.log('Bad line: ' + fields);
          stats['messages']['bad_lines_seen']++;
          continue;
        }
        if (fields[1].trim() === "ms") {
          if (!timers[key]) {
            timers[key] = [];
          }
          timers[key].push(Number(fields[0] || 0));
        } else if (fields[1].trim() === "c") {
          if (fields[2] && fields[2].match(/^@([\d\.]+)/)) {
            sampleRate = Number(fields[2].match(/^@([\d\.]+)/)[1]);
          }
          if (!counters[key]) {
            counters[key] = 0;
          }
          counters[key] += Number(fields[0] || 1) * (1 / sampleRate);
        } else {
          if (!gauges[key]) {
            gauges[key] = 0;
          }
          gauges[key] = Number(fields[0] || 0);
        }
      }
      stats['messages']['last_msg_seen'] = Math.round(new Date().getTime() / 1000);
    }
  });
  return server;
}

// create our stream server
function createStreamServer() {
  var server = net.createServer(function(cli) {
    console.log("Got stream server client connection..");
    var cliInt = setInterval(function(){
      var allData = {
        counters: counters,
        gauges: gauges,
        timers: timers,
        startup_time: startup_time
      };

      cli.write(JSON.stringify(allData));
    }, 1000);

    cli.on("end", function() {
      clearInterval(cliInt);
      console.log("Got stream server client disconnection..");
    });
  });
  return server;
}

// Create our mgmt server
function createMgmtServer() {
  var server = net.createServer(function(stream) {
    stream.setEncoding('ascii');
    stream.on('data', function(data) {
      var cmdline = data.trim().split(" ");
      var cmd = cmdline.shift();

      switch(cmd) {
        case "help":
          stream.write("Commands: stats, all, counters, gauges, timers, delcounters, deltimers, quit\n\n");
          break;
        case "stats":
          var now    = Math.round(new Date().getTime() / 1000);
          var uptime = now - startup_time;
          stream.write("uptime: " + uptime + "\n");

          for (var group in stats) {
            for (var metric in stats[group]) {
              var val;
              if (metric.match("^last_")) {
                val = now - stats[group][metric];
              }
              else {
                val = stats[group][metric];
              }
              stream.write(group + "." + metric + ": " + val + "\n");
            }
          }
          stream.write("END\n\n");
          break;
        case "all":
          var allData = {
            counters: counters,
            gauges: gauges,
            timers: timers
          };
          stream.write(JSON.stringify(allData) + "\n");
          stream.write("END\n\n");
          break;
        case "counters":
          stream.write(util.inspect(counters) + "\n");
          stream.write("END\n\n");
          break;
        case "gauges":
          stream.write(util.inspect(gauges) + "\n");
          stream.write("END\n\n");
          break;
        case "timers":
          stream.write(util.inspect(timers) + "\n");
          stream.write("END\n\n");
          break;
        case "delcounters":
          for (var index in cmdline) {
            delete counters[cmdline[index]];
            stream.write("deleted: " + cmdline[index] + "\n");
          }
          stream.write("END\n\n");
          break;
        case "deltimers":
          for (var index in cmdline) { // jshint ignore:line
            delete timers[cmdline[index]];
            stream.write("deleted: " + cmdline[index] + "\n");
          }
          stream.write("END\n\n");
          break;
        case "quit":
          stream.end();
          break;
        default:
          stream.write("ERROR\n");
          break;
      }
    });
  });
  return server;
}

function parseState(state) {
  var d;
  try {
    d = JSON.parse(state.toString());
  } catch (x) {
    fatal("Error parsing data: " + util.inspect(data.toString()) + " - " + util.inspect(x));
  }

  counters = d.counters;
  gauges = d.gauges;
  timers = d.timers;
  startup_time = d.startup_time;
  return d;
}

// contact the 'stream' server and get our initial values
function attachToStreamServer(config) {
  if (!attachMode) {
    return;
  }

  var cli = net.createConnection(config.stream_port, config.stream_host);

  cli.on('data', function(data) {
    parseState(data);
  });

  cli.on('end', function(){
  });

  cli.on('error', function(err) {
    fatal("Error connecting to stream server: " + util.inspect(err) + " config: " + util.inspect(config));
  });
}

// fatal error handler
function fatal(err) {
  console.error(err);
  process.exit(1);
}

// load internal state from file
function loadInternalState(cb) {
  if (!loadLogFile) return cb();
  fs.exists(loadLogFile, function(exists){
    if (!exists) {
      fatal("State file does not exist: " + loadLogFile);
    }
    fs.readFile(loadLogFile, function(err, data){
      if (err) {
        fatal(err);
      }
      parseState(data);
      cb();
    });
  });
}

// save internal state to file
function setupSaveInternalState() {
  if (saveLogFile) {
    setInterval(function(){
      var allData = {
        counters: counters,
        gauges: gauges,
        timers: timers,
        startup_time: startup_time
      };
      fs.writeFile(saveLogFile, JSON.stringify(allData), function(err){
        if (err) fatal(err);
      });
    }, 2000);
  }
}

// main entry point
config.configFile(configFile, function (config) {
  if (! config.debug && debugInt) {
    clearInterval(debugInt);
    debugInt = false;
  }

  if (config.debug) {
    if (debugInt !== undefined) {
      clearInterval(debugInt);
    }
    debugInt = setInterval(function () {
      util.log("Counters:\n" + util.inspect(counters) + "\nGauges:\n" + util.inspect(gauges) + "\nTimers:\n" + util.inspect(timers));
    }, config.debugInterval || 10000);
  }

  loadInternalState(function() {
    if (!attachMode) {
      server = createUDPServer(config);
      server.bind(config.port || 8125, config.address || '0.0.0.0');

      streamServer = createStreamServer(config);
      streamServer.listen(config.stream_port || 8147, config.stream_address);

      mgmtServer = createMgmtServer(config);
      mgmtServer.listen(config.mgmt_port || 8147, config.mgmt_address);
    }

    // if attach mode, attach to our stream server
    attachToStreamServer(config);

    // setup timer to save state (if specified)
    setupSaveInternalState();

    if (daemonMode === false) {
      // close everything and exit if any char pressed
      w.on('inputChar', function() {
        clearInterval(refreshInt);
        clearInterval(flushInt);

        if (w) {
          w.close();
        }

        if (server) {
          server.close();
        }

        if (mgmtServer) {
          mgmtServer.close();
        }

        if (streamServer) {
          streamServer.close();
        }
      });

      // interval for refresh
      refreshInt = setInterval(function() {
        refresh();
      }, 1000);

      // initial banner
      printTop();
      w.refresh();
    } else {
      console.log("Running in daemon mode.. ");
    }
  });
});
