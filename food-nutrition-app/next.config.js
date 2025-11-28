/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config) => {
        config.externals.push('better-sqlite3');
        return config;
    },
    turbopack: {
        // Empty config to silence the warning
    },
}

module.exports = nextConfig
