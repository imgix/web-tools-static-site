var argv = require('yargs').argv,
    _ = require('lodash'),
    fs = require('fs'),
    path = require('path'),
    through = require('through2'),
    reporter = require('reporter-plus/lib/reporter'),
    Vinyl = require('vinyl');

module.exports = function setupNunjucksPagesPipeline(gulp) {
  var PAGE_OPTIONS = {
    data: _.isObject,
    template: _.isString,
    routes: _.isArray,
    filename: _.isString
  };

  return function nunjucksPagesPipeline(options) {
    var pageList = [],
        templates,
        siteData;

    options = _.defaults({}, options, {
      templates: 'templates',
      siteData: 'sitedata',
      routeMap: './routes.json',
      netlifyRouteRedirects: './_redirects'
    });

    // Attempt to get usable templates
    if (_.isFunction(options.templates)) {
      templates = options.templates(gulp);
    } else {
      templates = _.get(gulp, options.templates, {});
    }

    // Attempt to get usable siteData
    if (_.isFunction(options.siteData)) {
      siteData = options.siteData(gulp);
    } else {
      siteData = _.get(gulp, options.siteData);
    }

    return through.obj(
      function transform(file, encoding, callback) {
          var stream = this,
              pagesConfig;

          // Make sure the config isn't in the cache;
          delete require.cache[require.resolve(file.path)]
          pagesConfig = require(file.path) || {};

          // Build a data structure from the given pages
          _.each(pagesConfig, function getIndividualPagesByType(pageTypeOptions, pageType) {
            var pagesData = pageTypeOptions.data;

            if (_.isFunction(pagesData)) {
              pagesData = pagesData(siteData || {});
            }

            pagesData = _.castArray(pagesData);

            _.each(pagesData, function renderPage(pageData) {
              pageList.push(_.mapValues(PAGE_OPTIONS, function setKey(typeChecker, key) {
                var value = (key === 'data') ? pageData : pageTypeOptions[key];

                if (_.isFunction(value)) {
                  value = value(pageData);
                }

                return typeChecker(value) ? value : null;
              }));
            });
          });

          callback();
        },
      function flush(callback) {
          var stream = this,
              errors = {},
              routeMap = {};

          _.each(pageList, function renderAndMapRoutes(pageOptions) {
            var template,
                renderedPage;

            // Find a template for this page
            template = _.get(templates, pageOptions.template);

            if (!_.isFunction(_.get(template, 'render'))) {
              errors[pageOptions.template] = [{
                filename: _.last(pageOptions.template.split(path.sep)),
                filepath: pageOptions.template,
                reason: 'Template does not exist',
                isError: true
              }];

              return;
            }

            // Render and push to stream
            try {
              renderedPage = template.render(pageOptions.data);
            } catch (renderError) {
              errors[pageOptions.template] = [{
                filename: _.get(renderError, 'filename'),
                filepath: _.get(renderError, 'filepath'),
                line: _.get(renderError, 'line'),
                char: _.get(renderError, 'char'),
                reason: _.get(renderError, 'message'),
                isError: true
              }];

              return;
            }

            if (_.isNull(renderedPage) || _.isUndefined(renderedPage)) {
              return;
            }

            stream.push(new Vinyl({
              path: pageOptions.filename,
              contents: new Buffer(renderedPage)
            }));

            // Make routeMap
            _.each(pageOptions.routes, function mapRoute(route) {
              routeMap[route] = pageOptions.filename;
            });
          });

          if (!_.isEmpty(errors)) {
            reporter(errors, 'static-site');
          }

          if (_.isString(options.routeMap)) {
            fs.writeFileSync(options.routeMap, JSON.stringify(routeMap, null, 2));
          }

          // Make _redirects file for Netlify
          if (argv.env === 'production') {
            _.each(routeMap, function (filename, route) {
              fs.appendFileSync(options.netlifyRouteRedirects, route + ' ' + filename + '\n');
            });
          }

          callback();
        }
    );
  };
};
