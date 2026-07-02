const api = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@skillescrow/shared'],
  async rewrites() { return [{ source: '/api/:path*', destination: `${api}/:path*` }]; },
};
