const base = require('./app.json');

module.exports = {
  ...base,
  expo: {
    ...base.expo,
    web: {
      ...base.expo.web,
      baseUrl: process.env.DEPLOY_TARGET === 'github-pages' ? '/DuanOS' : '/',
    },
  },
};
