const path = require('path');

module.exports = {
  mode: 'production', // Set the mode to 'production' or 'development'
  entry: './main.js', // Ensure this path is correct
  output: {
    filename: 'solana-web3-bundle.js',
    path: path.resolve(__dirname, 'wwwroot/js')
  },
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/'),
      process: require.resolve('process/browser'),
      path: require.resolve('path-browserify')
    }
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      }
    ]
  }
};
