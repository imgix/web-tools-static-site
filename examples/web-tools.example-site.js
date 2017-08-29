var _ = require('lodash');

module.exports = {
  index: {
      data: {},
      template: 'page.index.njk',
      routes: [
          '/',
          '/home'
        ],
      filename: 'index.html'
    },
  about: {
      data: {},
      template: 'page.about.njk',
      routes: [
          '/about'
        ],
      filename: 'about.html'
    },
  404: {
      data: {},
      template: 'page.404.njk',
      routes: [
          '/404'
        ],
      filename: '404.html'
    },
  feed: {
      data: function (siteData) {
          return {
            posts: siteData.getAll('post')
          };
        },
      template: 'page.feed.njk',
      routes: [
          '/rss',
          '/feed'
        ],
      filename: 'rss.xml'
    },
  post: {
      data: function (siteData) {
          return siteData.getAll('post');
        },
      template: function (postData) {
          switch (postData.type) {
            case 'specialty':
              return 'page.post.specialty.njk';
            default:
              return 'page.post.njk';
          }
        },
      routes: function (postData) {
          var slug = postData.slug;

          return [
            '/posts/' + slug
          ];
        },
      filename: function (postData) {
          return 'posts/' + postData.slug + '.html'
        }
    }
};
