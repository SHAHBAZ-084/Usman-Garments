'use strict';

const path = require('path');
const { rcedit } = require('rcedit');

/**
 * electron-builder's signAndEditExecutable pulls winCodeSign, which fails on
 * Windows without symlink privilege. Embed the .ico ourselves after pack.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');
  const version = context.packager.appInfo.version;

  await rcedit(exePath, {
    icon: iconPath,
    'file-version': version,
    'product-version': version,
    'version-string': {
      CompanyName: 'Usman Mall',
      FileDescription: 'Usman Mall',
      ProductName: 'Usman Mall',
      LegalCopyright: 'Usman Mall',
    },
  });

  console.log(`Embedded icon into ${exeName}`);
};
