#!/usr/bin/env node
//
//  Main FeedHenry Stats Server.
//
var util = require('util');
var args = require('optimist').argv;
var fs = require('fs');
var path = require('path');
var statsserver = require('../lib/statsserver.js');
var cluster = require('cluster');
var fhconfig = require('fh-config');
var required = require('../lib/requiredvalidation.js');
var fh_logger = require('fh-logger');
var workers = []; //holds ref to worker processes
var statsServer;

function usage() {
  console.log("Usage: " + args.$0 + " <config file> -d (debug) --master-only (singe node process)");
  process.exit(0);
}

if(args.h) {
  usage();
}

if(args._.length !== 1) {
  usage();
}

var configFile = args._[0];
var config;

fhconfig.init(configFile, required, function(err) {
  if(err) {
    console.error("Problems reading config file: " + configFile);
    console.error(err);
    process.exit(-1);
  }

  config = fhconfig.getConfig().rawConfig;
  config.configFilePath = path.resolve(configFile);
  config.configDir = path.dirname(config.configFilePath);
  var logger = fh_logger.createLogger(config.statsserver.logger);

  // Get version number from package.json
  var pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), "utf8"));
  var statsdVersionNumber = pkg.version;

  // Handle uncaught exceptions
  process.on('uncaughtException', function(err) {
    logger.error("FATAL: UncaughtException, please report: " + util.inspect(err));
    console.error(new Date().toString() + " FATAL: UncaughtException, please report: " + util.inspect(err));
    if (err != undefined && err.stack != undefined) { // jshint ignore:line
      logger.error(util.inspect(err.stack));
    }
    cleanShutdown();  // exit on uncaught exception.
  });

  // Shutdown and Signals
  var cleanShutdown = function() {
    logger.info("Got shutdown signal");
    if (cluster.isWorker) {
      try {
        if (statsServer) statsServer.server.close();
      } catch (x) {
        logger.error("Ignoring Server shutdown error: " + x);
      }
      process.exit(0);
    }else {
      // shutdown all workers
      // we exit when all workers have exited.
      for (var i = 0; i < workers.length; i++) {
        var worker = workers[i];
        if(worker.destroy) worker.destroy();
        else if (worker.kill) worker.kill();
        else if (worker.process && worker.process.kill) worker.process.kill();
      }
    }
  };

  process.on('SIGTERM', cleanShutdown);
  process.on('SIGHUP', cleanShutdown);

  function startWorker() {
    statsServer = new statsserver.StatsServer(config, logger, statsdVersionNumber);
    statsServer.server.listen(config.statsserver.port, function() {
      logger.info("Started fh-stats Server version " + statsdVersionNumber +
        " on port: " + config.statsserver.port);
    });
  }

  if (args["master-only"] ||  args.d) {
    logger.info("starting single master process");
    startWorker();
  }else{
    if (cluster.isMaster) {
      // Fork workers. Note for statsd we only fork 1 worker.
      // Leaving the 'workers' array pattern as this may change in future (i.e. we may fork more)
      logger.info("Master process, forking: 1 worker");
      var worker = cluster.fork();
      workers.push(worker);

      // Handle workers exiting
      cluster.on('exit', function(worker) {
        if (worker.suicide === true) {
          logger.info("Worker has cleanly exited: " + util.inspect(worker.process.pid));
          for (var i = 0; i < workers.length; i++) {
            if (workers[i] && workers[i].id === worker.id) workers.splice(i);
          }
          if (workers.length === 0) {
            logger.info("All workers have exited, Master is exiting..");
            process.exit(0);
          }
        } else {
          var msg = "Proxy worker: " + worker.process.pid + " has died!! Respawning..";
          logger.error(msg);
          var newWorker = cluster.fork();
          for (var y = 0; y < workers.length; y++) {
            if (workers[y] && workers[y].id === worker.id) workers.splice(y);
          }
          workers.push(newWorker);
        }
      });
    } else {
      // Finally start the Stats Server.
      startWorker();
    }
  }


});
