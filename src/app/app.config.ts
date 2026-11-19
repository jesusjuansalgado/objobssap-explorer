import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { AppConfigService } from './core/app-config.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Read config.json / services.json before the first render.
    provideAppInitializer(() => inject(AppConfigService).load()),
  ],
};
