const ExpressHttpProxy = require('express-http-proxy');
const https = require('https');
const express = require('express');
const morgan = require('morgan');
const path = require('path');
const appDir = process.cwd();
const fs = require('fs');
const os = require('os');
const serveIndex = require('serve-index');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const axios = require('axios');
const { name } = require('../package.json');
const routes = require('./routes');

const certKey = fs.readFileSync(path.join(__dirname, 'certs', 'selfsigned.key'));
const certCrt = fs.readFileSync(path.join(__dirname, 'certs', 'selfsigned.crt'));

const HttpServer = async (options = {}) => {
  const { vtex, httpDebug } = options;
  let { storeId, store, paths } = vtex;

  storeId = storeId || store;

  if (!storeId) {
    console.error(`😨 storeId is required for package ${name}`);
    process.exit();
  }

  const host = `${storeId}.vtexlocal.online.pro.br`;
  const port = options.port ? options.port : 443;
  const httpServerOptions = {
    key: certKey,
    cert: certCrt,
  };
  const server = express();

  server.use(cookieParser());
  server.use(cors());

  server.options(
    '*',
    cors({
      preflightContinue: false,
      credentials: false,
      exposedHeaders: ['Content-Type', 'X-vtex-api-appKey', 'X-vtex-api-appToken', 'REST-Range', 'X-type-request'],
      allowedHeaders: ['Content-Type', 'X-vtex-api-appKey', 'X-vtex-api-appToken', 'REST-Range', 'X-type-request'],
    }),
  );

  const STORE_URL = `https://${vtex.store}.vtexcommercestable.com.br/`;
  const STORE_LOCAL_URL = `https://${host}:${port}/`;
  const STORE_URL_STATICS = `https://${vtex.store}.vteximg.com.br`;

  const configProxy = {
    secure: false,
    parseReqBody: true,
    proxyReqOptDecorator(proxyReqOpts, srcReq) {
      proxyReqOpts.headers.referer = STORE_URL;
      proxyReqOpts.headers.origin = STORE_URL;
      proxyReqOpts.headers.host = STORE_URL.replace('https://', '').replace('/', '');

      return proxyReqOpts;
    },

    userResHeaderDecorator(headers, userReq, userRes, proxyReq, proxyRes) {
      if (headers.location) {
        headers.location = headers.location.replace(STORE_URL, '/');
      }
      headers['Access-Control-Allow-Origin'] = STORE_LOCAL_URL;
      if (headers['set-cookie']) {
        headers['set-cookie'] = headers['set-cookie'].map((cookie) => {
          return cookie.replace(STORE_URL.replace('https://', '').replace('/', ''), host);
        });
      }

      return headers;
    },
    proxyReqBodyDecorator(bodyContent, srcReq) {
      bodyContent = decodeURIComponent(bodyContent.toString('utf8')).replace(
        new RegExp(STORE_LOCAL_URL, 'g'),
        STORE_URL,
      );

      return bodyContent;
    },
    async userResDecorator(proxyRes, proxyResData, userReq, userRes) {
      let htmlData = proxyResData.toString('utf8');

      const reg = new RegExp(`${STORE_URL_STATICS}/arquivos`, 'g');
      htmlData = htmlData.replace(reg, `${STORE_LOCAL_URL}arquivos`);

      const reg2 = new RegExp(STORE_URL, 'g');
      htmlData = htmlData.replace(reg2, STORE_LOCAL_URL);

      return htmlData;
    },
  };

  paths.forEach((item) => {
    if (item.type === 'templates') {
      for (const route of routes.templates) {
        server[route.method](
          `${item.route}${route.route}`,
          route.handler.bind(route, {
            templateDirectory: item.folder,
            vtex,
          }),
        );
      }
    }

    if (item.route) {
      server.use(
        item.route,
        express.static(path.join(appDir, item.folder), { index: false }),
        serveIndex(path.join(appDir, item.folder), {
          icons: true,
        }),
      );
    }
  });

  if (httpDebug) {
    server.use(morgan('combined'));
  }

  server.use('/', ExpressHttpProxy(STORE_URL, configProxy));

  const serverHttps = https.createServer(httpServerOptions, server);
  serverHttps.listen(port);
  console.log(`Proxy Server started on ${STORE_LOCAL_URL}`);

  return serverHttps;
};

module.exports = HttpServer;
