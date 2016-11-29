#!/usr/bin/env node
var statsc = require("fh-statsc");
var async = require('async');
var rc = require('rc')('basher', {
    //default props
    host: 'localhost',
    port: 8145,
    count: 500
});

console.dir(rc);

function usage() {
  console.log("basher.js TODO");
  process.exit(1);
};

var stats = statsc.FHStats({host: rc.host, port: rc.port, enabled: true});

function sendStat(count, cb) {
  var rnd = Math.floor((Math.random()*100000)+1);
  stats.gauge('aa_' + rnd, rnd, function(err){
    if (err) console.error(err);
    stats.inc("num_calls", function(err) {
      return cb(err);
    });
  });
};

var count = 0;
async.whilst(
  function () { return count < rc.count; },
  function (callback) {
    count++;
    sendStat(count, callback);
  },
  function (err) {
    if(err) console.error(err);
    console.log("All done, num sent: " + count);
    process.exit(0);
  }
);