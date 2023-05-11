const { isBuffer } = require('lodash');
var _ = require('lodash'),
    fs = require('fs'),
    path = require('path'),
    fetch = require('node-fetch'),
    through = require('through2'),
    reporter = require('reporter-plus/lib/reporter'),
    Vinyl = require('vinyl'),
    path = require('path'),
    asyncDash = require('async-dash'),
    args = require('yargs').argv;

module.exports = function setupNunjucksPagesPipeline(gulp) {
  var PAGE_OPTIONS = {
    data: _.isObject,
    template: _.isString,
    routes: _.isArray,
    filename: _.isString,
    priority: _.isNumber,
    lastModDate: _.isDate
  };

  return function nunjucksPagesPipeline(options) {
    var pageList = [],
        templates,
        siteData,
        {
          repo,
          accessToken,
          contentBase,
          siteBase,
          templatesDir,
          templatesSubDirArray
        } = options.repoInfo,
        jobScoreURL = 'https://careers.jobscore.com/jobs/imgix/feed.json';

    options = _.defaults({}, options, {
      templates: 'templates',
      siteData: 'sitedata',
      routeMaps: {
          './routes.json': function (routeMap) {
              return JSON.stringify(routeMap, null, 2);
            }
        }
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
      async function flush(callback) {
          var stream = this,
              errors = {},
              routeMap = {},
              templatesSubDir = {};

          await asyncDash.asyncEach(pageList, async function renderAndMapRoutes(pageOptions) {
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
            _.each(pageOptions.routes, function mapRoute(route, index) {
              if (index === 0) {
                _.set(routeMap, 'rewrites["' + route + '"]', pageOptions.filename);
              } else {
                _.set(routeMap, 'redirects["' + route + '"]', _.first(pageOptions.routes));
              }
            });

            if(!!args.generate && pageOptions.routes[0][0] !== '#') {
              var baseAPIPath = `https://api.github.com/repos/zebrafishlabs/${repo}/commits`,
                contentFile = pageOptions.data.contentDirectory || pageOptions.data.content?.contentDirectory || pageOptions.data.post?.contentDirectory,
                contentPath,
                templatePathArray = [siteBase, templatesDir],
                templatePath,
                apiPath = (path) => baseAPIPath + `?path=${path}`,
                lastModDates = [],
                route = pageOptions.routes[0];

              if (route === '/') route = '';

              if (pageOptions.lastModDate) lastModDates.push(pageOptions.lastModDate);

              // Matches template name to template's sub directory. Make sure the subdirectory matches template name in repo
              if (templatesSubDirArray) {
                for (let subDir of templatesSubDirArray) {
                  if (templatesSubDir[pageOptions.template]) {
                    continue;
                  } else if (pageOptions.template.indexOf(subDir) > 0) {
                    templatesSubDir[pageOptions.template] = subDir;
                  }
                }

                templatePathArray.push(templatesSubDir[pageOptions.template], pageOptions.template);
              }

              templatePath = templatePathArray.join('/');

              // Makes individual API calls for most recent modified dates for jobscore + content and template files for each route
              if (route === ('/careers')) {
                await fetch(jobScoreURL)
                  .then(data => data.json())
                  .then((jobsData) => {
                    lastModDates.push(jobsData.last_updated);
                  })
                  .catch(function onError(error) {
                    console.log('Error fetching from ' + jobScoreURL + ':', error);
                  });
              }

              if(contentFile && !pageOptions.lastModDate) {
                contentPath = contentBase.concat('/', contentFile)

                await fetch(apiPath(contentPath), {
                  headers: { 'Authorization': `Bearer ${accessToken}` }
                })
                .then(data => data.json())
                .then((commit) => {
                  lastModDates.push(new Date(commit[0].commit.committer.date).toISOString());
                })
                .catch(function onError(error) {
                  console.log('Error fetching from ' + apiPath(contentPath) + ':', error);
                });
              }

              await fetch(apiPath(templatePath), {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              })
              .then(data => data.json())
              .then((commit) => {
                lastModDates.push(new Date (commit[0].commit.committer.date).toISOString());
                _.set(routeMap, 'sitemapXML["' + route + '"][lastModDate]', lastModDates.reduce((date, currentDate)=> {
                  return date > currentDate ? date : currentDate}));
              })
              .catch(function onError(error) {
                console.log('Error fetching from ' + apiPath(templatePath) + ':', error);
              });

              _.set(routeMap, 'sitemapXML["' + route + '"][priority]', pageOptions.priority);
            }
          });

          if (!_.isEmpty(errors)) {
            reporter(errors, 'static-site');
          }

          _.each(options.routeMaps, function renderRouteMap(renderer, fileName) {
            fs.writeFileSync(fileName, renderer(routeMap));
          });

          callback();
        }
    );
  };
};
