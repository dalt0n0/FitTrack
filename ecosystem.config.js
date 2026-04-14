module.exports = {
  apps: [{
    name: 'fittrack',
    script: 'server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      FDC_API_KEY: 'bv5ZXgeqvXzI1TvGAAFXS9tCbyyL2xYDEQkvvmtB'
    }
  }]
};
