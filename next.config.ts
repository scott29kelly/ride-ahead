import type { NextConfig } from 'next';

const config: NextConfig = {
  images: {
    // Imagery is proxied straight from the providers, so allow their hosts.
    remotePatterns: [
      { protocol: 'https', hostname: '*.mapillary.com' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'maps.googleapis.com' },
    ],
  },
};

export default config;
