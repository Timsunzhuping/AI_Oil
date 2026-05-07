/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 后端 API 代理：开发模式下将 /api/v1/* 转发到 backend (3001)。
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.BACKEND_URL ?? 'http://localhost:3001'}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
