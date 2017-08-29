var _ = require('lodash');

module.exports = function setUpDS(gulp) {
  gulp.pipelineCache.put('static-site', require('./pipelines/pipeline.static-site.js'));

  gulp.middlewareCache.put('static-site', require('./middleware/middleware.static-site.js'));
}
