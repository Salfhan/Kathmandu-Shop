import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kathmandu.smp.shop',
  appName: 'Kathmandu SMP Shop',
  webDir: 'www',
  server: {
    url: 'https://kathmandu-minecraft-smp-e-shop-br6yqx.v2.appdeploy.ai/',
    cleartext: false,
    allowNavigation: [
      'kathmandu-minecraft-smp-e-shop-br6yqx.v2.appdeploy.ai'
    ]
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
