var fs  = require('fs');
var util = require('util');

var Configurator = function (file) {

  var self = this;
  // jshint ignore:start
  var config = {};
  var oldConfig = {};
  // jshint ignore:end

  this.updateConfig = function () {
    util.log('reading config file: ' + file);

    fs.readFile(file, function (err) {
      if (err) {
        throw err;
      }
      old_config = self.config;

      self.config = eval('config = ' + fs.readFileSync(file));
      self.emit('configChanged', self.config);
    });
  };

  this.updateConfig();

  fs.watchFile(file, function (curr, prev) {
    if (curr.ino !== prev.ino) {
      self.updateConfig();
    }
  });
};

util.inherits(Configurator, process.EventEmitter);

exports.Configurator = Configurator;

exports.configFile = function(file, callbackFunc) {
  var config = new Configurator(file);
  config.on('configChanged', function() {
    callbackFunc(config.config, config.oldConfig);
  });
}
