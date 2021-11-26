const path = require("path");

module.exports = {
  mode: process.env.NODE_ENV,
  devtool: "inline-source-map",
  entry: {
    main: "./src/index.ts",
  },
  output: {
    path: path.resolve(__dirname, "./dist"),
    filename: "client.js",
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "expose-loader",
            options: {
              exposes: { globalName: "Reimu", moduleLocalName: "Reimu" },
            },
          },
          {
            loader: "ts-loader",
          },
        ],
        exclude: /node_modules/,
      },
    ],
  },
};
