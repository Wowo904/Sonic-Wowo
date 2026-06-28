import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.alexw.sonictopography',
  appName: 'Sonic Topography',
  webDir: 'dist',
  server: {
    cleartext: true,
  },
  ios: {
    contentInset: 'always',
    scheme: 'SonicTopography',
  },
};

export default config;
