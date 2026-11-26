import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kathmandu.smp.shop',
  appName: 'Kathmandu SMP Shop',
  webDir: 'dist',
  android: { allowMixedContent: false }
};

export default config;
