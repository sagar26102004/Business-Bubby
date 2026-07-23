/** Entry point — boots the HTTP server. */
import { config, assertConfig } from '@/config';
import { createApp } from '@/app';

assertConfig();

const app = createApp();
app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[localo-backend] listening on http://localhost:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`[localo-backend] docs at http://localhost:${config.port}/docs`);
});
