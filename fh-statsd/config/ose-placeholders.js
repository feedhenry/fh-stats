var placeholders = {
  "statsserver.port": 8080,
  "statsserver.statscollector.port": 8081,
  "statsserver.logger": {
    "name": "statsserver",
    "streams": [{
      "type": "stream",
      "src": true,
      "level": "$(FH_LOG_LEVEL)",
      "stream": "process.stdout"
    }]
  },
  "statsserver.statsAPIKey": "$(FH_STATSD_API_KEY)"
};

module.exports = placeholders;
