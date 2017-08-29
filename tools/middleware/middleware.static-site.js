var _ = require('lodash'),
    fs = require('fs'),
    path = require('path'),
    express = require('express'),
    STATIC_CACHE_AGE = 365 * 24 * 60 * 60 * 1000; // 1 year;;

module.exports = function configureServer(app, config) {
  var routeMapFile = _.get(config, 'server.routeMap'),
      fallbackFile = _.get(config, 'server.fallbackFile');

  function getRouteMap() {
    return JSON.parse(fs.readFileSync(path.join(config.destPath, routeMapFile)));
  }

  // No route map, no problems
  if (!(routeMapFile && fs.existsSync(path.join(config.destPath, routeMapFile)))) {
    return;
  }

  // If we're caching the route map, we can just use express.static
  if (_.get(config, 'server.cacheRouteMap')) {
    _.each(getRouteMap(), function setupRoute(file, route) {
      app.use(route, express.static(path.join(config.destPath, file)));
    });

  // If we're not caching the route map, check it on every request
  } else {
    app.use(function checkRoute(request, response, next) {
      var routeMap = getRouteMap(),
          file = routeMap[request.url];

      if (!!file && fs.existsSync(path.join(config.destPath, file))) {
        response.sendFile(file, {
          root: config.destPath,
          headers: {
              'Cache-Control': 'private, no-cache, max-age=0'
            }
        });
      } else {
        next();
      }
    });
  }
};
