module.exports = {
  extends: "./electron-builder.yml",
  appId: "com.oldpan.pavra.desktop",
  productName: "Pavra",
  executableName: "Pavra",
  extraMetadata: { name: "pavra", productName: "Pavra" },
  protocols: [{ name: "Pavra link", schemes: ["pavra"] }],
  directories: { output: "release-pavra" },
  publish: null,
  afterSign: null,
  mac: {
    icon: "../app/assets/images/pavra-icon.png",
    artifactName: "Pavra-${version}-${arch}.${ext}",
    notarize: false,
  },
};
