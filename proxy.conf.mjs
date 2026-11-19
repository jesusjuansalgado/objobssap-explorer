// Dev-server proxy (`ng serve`): the same /proxy?url=... endpoint as server/server.mjs.
import { handleProxy, loadAllowedHosts } from './server/proxy-core.mjs';

export default {
  '/proxy': {
    target: 'http://localhost', // never contacted: bypass() answers the request itself
    async bypass(req, res) {
      await handleProxy(req, res, loadAllowedHosts('public/services.json'));
      return req.url; // response already ended, so the dev server stops here
    },
  },
};
