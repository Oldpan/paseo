module.exports = {
  extends: "./electron-builder.yml",
  appId: "com.oldpan.bigbang.studio.desktop",
  productName: "Bigbang Studio",
  executableName: "Bigbang Studio",
  extraMetadata: { name: "bigbang-studio", productName: "Bigbang Studio" },
  protocols: [{ name: "Bigbang Studio link", schemes: ["bigbang-studio"] }],
  directories: { output: "release-bigbang" },
  publish: null,
  afterSign: null,
  mac: {
    icon: "../app/assets/images/bigbang-icon.png",
    artifactName: "Bigbang-Studio-${version}-${arch}.${ext}",
    notarize: false,
  },
};
