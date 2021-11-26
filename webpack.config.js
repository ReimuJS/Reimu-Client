const path = require("path");
const UglifyJsPlugin = require("uglifyjs-webpack-plugin");

module.exports = {
  entry: {
    reimu: "./src/index.ts",
    "reimu.min": "./src/index.ts",
  },
  output: {
    path: path.resolve(__dirname, "_bundles"),
    filename: "[name].js",
    libraryTarget: "umd",
    library: "Reimu",
    umdNamedDefine: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  devtool: "source-map",
  plugins: [
    new UglifyJsPlugin({
      sourceMap: true,
      include: /\.min\.js$/,
    }),
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "awesome-typescript-loader",
            options: {
              query: {
                declaration: false,
              },
            },
          },
        ],
        exclude: /node_modules/,
      },
    ],
  },
};
